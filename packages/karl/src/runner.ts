import { agentLoop, getModel, setApiKey } from '@mariozechner/pi-ai';
import { createBuiltinTools, loadCustomTools } from './tools.js';
import { HookRunner } from './hooks.js';
import { SchedulerEvent, TaskResult, TokenUsage, ToolsConfig } from './types.js';
import { formatError } from './utils.js';
import { TaskRunError, TimeoutError } from './errors.js';

/**
 * Map karl provider keys to pi-ai provider names
 * karl uses provider names from config (e.g., "claude-pro-max")
 * pi-ai uses standard provider names (e.g., "anthropic")
 */
function mapToPiAiProvider(providerKey: string): string {
  const mapping: Record<string, string> = {
    'claude-pro-max': 'anthropic',
  };
  return mapping[providerKey] ?? providerKey;
}

export interface RunTaskParams {
  task: string;
  index: number;
  attempt: number;
  cwd: string;
  model: string;
  providerKey: string;
  apiKey: string;
  systemPrompt: string;
  hooks: HookRunner;
  toolsConfig: ToolsConfig;
  noTools?: boolean;
  unrestricted?: boolean;
  timeoutMs?: number;
  onEvent?: (event: SchedulerEvent) => void;
}

function extractTokens(usage: any): TokenUsage | undefined {
  if (!usage || typeof usage !== 'object') {
    return undefined;
  }
  const input = usage.input ?? usage.inputTokens ?? usage.prompt_tokens;
  const output = usage.output ?? usage.outputTokens ?? usage.completion_tokens;
  const total = usage.total ?? usage.totalTokens;
  // Cost might be an object with total, or a number directly
  const costValue = typeof usage.cost === 'object' ? usage.cost?.total : usage.cost;
  if (input === undefined && output === undefined && total === undefined && costValue === undefined) {
    return undefined;
  }
  return { input, output, total, cost: costValue };
}

async function runWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs?: number,
  controller?: AbortController | null
): Promise<T> {
  if (!timeoutMs) {
    return await promise;
  }
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller?.abort();
      reject(new TimeoutError(`Task timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export async function runTask(params: RunTaskParams): Promise<TaskResult> {
  const toolsUsed = new Set<string>();
  const onEvent = (event: SchedulerEvent) => {
    if (event.type === 'tool_start' || event.type === 'tool_end') {
      toolsUsed.add(event.tool);
    }
    params.onEvent?.(event);
  };

  const startTime = Date.now();
  onEvent({ type: 'task_start', taskIndex: params.index, task: params.task, time: startTime });

  await params.hooks.run('pre-task', {
    task: params.task,
    index: params.index,
    attempt: params.attempt,
    model: params.model,
    provider: params.providerKey
  });

  try {
    const ctx = {
      cwd: params.cwd,
      hooks: params.hooks,
      onEvent,
      task: params.task,
      taskIndex: params.index,
      unrestricted: params.unrestricted
    };

    let tools: any[] = [];
    if (!params.noTools) {
      const builtinTools = await createBuiltinTools(ctx);
      const enabled = new Set(params.toolsConfig.enabled ?? []);
      const filteredBuiltins =
        params.toolsConfig.enabled.length > 0 ? builtinTools.filter((tool) => enabled.has(tool.name)) : builtinTools;
      const customTools = await loadCustomTools(params.toolsConfig.custom ?? [], ctx);
      tools = [...filteredBuiltins, ...customTools];
    }

    // Map provider key to pi-ai provider name
    const piAiProvider = mapToPiAiProvider(params.providerKey);

    // Set API key for the provider
    setApiKey(piAiProvider, params.apiKey);

    // Get model config from pi-ai
    const model = getModel(piAiProvider, params.model);

    // Build context
    const context = {
      systemPrompt: params.systemPrompt,
      messages: [] as any[],
      tools
    };

    // Build user message
    const userMessage = {
      role: 'user' as const,
      content: params.task,
      timestamp: Date.now()
    };

    // Config for agent loop
    const loopConfig = {
      model,
      apiKey: params.apiKey
    };

    const controller = params.timeoutMs ? new AbortController() : null;

    // Run agent loop
    const runPromise = (async () => {
      let finalText = '';
      let finalUsage: any = null;

      for await (const event of agentLoop(userMessage, context, loopConfig, controller?.signal)) {
        switch (event.type) {
          case 'tool_execution_start':
            onEvent({
              type: 'tool_start',
              taskIndex: params.index,
              tool: event.toolName,
              time: Date.now()
            });
            break;
          case 'tool_execution_end':
            toolsUsed.add(event.toolName);
            onEvent({
              type: 'tool_end',
              taskIndex: params.index,
              tool: event.toolName,
              time: Date.now(),
              success: !event.isError
            });
            break;
          case 'message_update':
            // Emit thinking text as it streams
            if (event.message?.role === 'assistant') {
              const content = event.message.content;
              let text = '';
              if (typeof content === 'string') {
                text = content;
              } else if (Array.isArray(content)) {
                text = content
                  .filter((c: any) => c.type === 'text')
                  .map((c: any) => c.text)
                  .join('\n');
              }
              if (text) {
                onEvent({
                  type: 'thinking',
                  taskIndex: params.index,
                  text,
                  time: Date.now()
                });
              }
            }
            break;
          case 'message_end':
            if (event.message.role === 'assistant') {
              const content = event.message.content;
              if (typeof content === 'string') {
                finalText = content;
              } else if (Array.isArray(content)) {
                const textParts = content
                  .filter((c: any) => c.type === 'text')
                  .map((c: any) => c.text);
                if (textParts.length > 0) {
                  finalText = textParts.join('\n');
                }
              }
            }
            break;
          case 'turn_end':
            // Usage might be on the message or the event itself
            const usage = (event as any).usage ?? event.message?.usage;
            if (usage) {
              finalUsage = usage;
            }
            break;
        }
      }

      return { text: finalText, usage: finalUsage };
    })();

    const result = await runWithTimeout(runPromise, params.timeoutMs, controller);
    const tokens = extractTokens(result.usage);
    const durationMs = Date.now() - startTime;

    const taskResult: TaskResult = {
      task: params.task,
      status: 'success',
      result: result.text,
      durationMs,
      toolsUsed: Array.from(toolsUsed),
      tokens
    };

    onEvent({
      type: 'task_complete',
      taskIndex: params.index,
      task: params.task,
      time: Date.now(),
      result: result.text,
      durationMs,
      toolsUsed: taskResult.toolsUsed,
      tokens
    });

    await params.hooks.run('post-task', {
      task: params.task,
      index: params.index,
      attempt: params.attempt,
      model: params.model,
      provider: params.providerKey,
      result: result.text
    });

    return taskResult;
  } catch (error) {
    const message = formatError(error);
    const durationMs = Date.now() - startTime;

    await params.hooks.run('on-error', {
      scope: 'task',
      error: message,
      task: params.task,
      index: params.index
    });

    await params.hooks.run('post-task', {
      task: params.task,
      index: params.index,
      attempt: params.attempt,
      model: params.model,
      provider: params.providerKey,
      error: message
    });

    throw new TaskRunError(message, {
      retryable: (error as { retryable?: boolean }).retryable,
      toolsUsed: Array.from(toolsUsed),
      durationMs
    });
  }
}
