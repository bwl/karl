import { SchedulerEvent, SchedulerOptions, TaskResult } from './types.js';
import { formatError, sleep } from './utils.js';
import { TaskRunError } from './errors.js';

export type TaskRunner = (task: string, index: number, attempt: number) => Promise<TaskResult>;

function isRetryable(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const anyError = error as { retryable?: boolean; status?: number; code?: number };
    if (anyError.retryable) {
      return true;
    }
    const status = anyError.status ?? anyError.code;
    if (status && [408, 429, 500, 502, 503, 504].includes(status)) {
      return true;
    }
  }
  const message = formatError(error).toLowerCase();
  return message.includes('rate limit') || message.includes('timeout') || message.includes('temporar');
}

function backoffMs(attempt: number, strategy: 'exponential' | 'linear'): number {
  if (strategy === 'linear') {
    return Math.min(60_000, attempt * 1_000);
  }
  return Math.min(60_000, 1_000 * Math.pow(2, attempt - 1));
}

export class VolleyScheduler {
  constructor(
    private options: SchedulerOptions,
    private onEvent?: (event: SchedulerEvent) => void
  ) {}

  async run(tasks: string[], runner: TaskRunner): Promise<TaskResult[]> {
    const results: TaskResult[] = new Array(tasks.length);
    const queue = tasks.map((task, index) => ({ task, index, attempt: 0 }));
    let active = 0;

    return await new Promise((resolve) => {
      const pump = () => {
        while (active < this.options.maxConcurrent && queue.length > 0) {
          const item = queue.shift();
          if (!item) {
            break;
          }
          active += 1;
          const attemptStart = Date.now();

          runner(item.task, item.index, item.attempt)
            .then((result) => {
              results[item.index] = result;
            })
            .catch(async (error) => {
              const retryable = isRetryable(error);
              if (retryable && item.attempt < this.options.retryAttempts) {
                const delayMs = backoffMs(item.attempt + 1, this.options.retryBackoff);
                this.onEvent?.({
                  type: 'task_retry',
                  taskIndex: item.index,
                  task: item.task,
                  time: Date.now(),
                  attempt: item.attempt + 1,
                  delayMs,
                  error: formatError(error)
                });
                await sleep(delayMs);
                queue.push({ ...item, attempt: item.attempt + 1 });
              } else {
                const message = formatError(error);
                const errorData = error as TaskRunError;
                const durationMs = errorData.durationMs ?? Date.now() - attemptStart;
                results[item.index] = {
                  task: item.task,
                  status: 'error',
                  error: message,
                  durationMs,
                  toolsUsed: errorData.toolsUsed ?? [],
                  tokens: errorData.tokens
                };
                this.onEvent?.({
                  type: 'task_error',
                  taskIndex: item.index,
                  task: item.task,
                  time: Date.now(),
                  error: message,
                  durationMs
                });
              }
            })
            .finally(() => {
              active -= 1;
              if (queue.length === 0 && active === 0) {
                resolve(results);
                return;
              }
              pump();
            });
        }

        if (queue.length === 0 && active === 0) {
          resolve(results);
        }
      };

      pump();
    });
  }
}
