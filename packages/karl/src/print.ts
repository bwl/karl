import { TaskResult, TokenUsage, type ToolDiff } from './types.js';
import type { HistoryRunEventRecord, HistoryRunRecord } from './history.js';
import { formatDuration } from './utils.js';

interface PrintOptions {
  json?: boolean;
  verbose?: boolean;
  stats?: boolean;
  historyId?: string;
  trace?: boolean;
  diffs?: ToolDiff[];
}

export type InspectionMode = 'summary' | 'verbose' | 'trace';

export function boundDisplayText(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  const head = Math.max(0, Math.floor(maxChars * 0.7));
  const tail = Math.max(0, maxChars - head);
  return {
    text: `${text.slice(0, head)}\n… [${text.length - maxChars} characters omitted] …\n${text.slice(-tail)}`,
    truncated: true,
  };
}

function payloadObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function responseObject(run: HistoryRunRecord): Record<string, unknown> | undefined {
  if (!run.response) return undefined;
  try { return payloadObject(JSON.parse(run.response)); } catch { return undefined; }
}

function phaseSummary(events: HistoryRunEventRecord[]): string | undefined {
  const phases = events.filter((event) => event.type === 'phase_finished').map((event) => {
    const phase = payloadObject(event.payload)?.phase;
    return typeof phase === 'string' ? `${phase} ${event.success ? 'ok' : 'failed'}` : undefined;
  }).filter((value): value is string => !!value);
  return phases.length ? phases.join(' -> ') : undefined;
}

function verificationSummary(run: HistoryRunRecord, events: HistoryRunEventRecord[]): string {
  const response = responseObject(run);
  const verification = response?.verification;
  if (Array.isArray(verification)) {
    const failed = verification.filter((entry) => Number(payloadObject(entry)?.exitCode) !== 0).length;
    return `${verification.length - failed} passed, ${failed} failed`;
  }
  const verify = [...events].reverse().find((event) => event.type === 'phase_finished' && payloadObject(event.payload)?.phase === 'verify');
  if (verify) return verify.success ? 'passed' : 'failed';
  const failures = events.filter((event) => event.type === 'tool_finished' && event.success === false).length;
  return failures ? `${failures} tool failure(s)` : 'not recorded';
}

function changedFileCount(run: HistoryRunRecord): number {
  const response = responseObject(run);
  if (Array.isArray(response?.changedFiles)) return response.changedFiles.length;
  return new Set((run.diffs ?? []).map((diff) => diff.path)).size;
}

function lastFailure(events: HistoryRunEventRecord[]): string | undefined {
  const failed = [...events].reverse().find((event) => event.success === false && (event.type === 'tool_finished' || event.type === 'phase_finished'));
  if (!failed) return undefined;
  const payload = JSON.stringify(failed.payload ?? {});
  return `${failed.toolName ?? failed.type}: ${boundDisplayText(payload, 240).text}`;
}

export function formatRunInspection(
  run: HistoryRunRecord,
  events: HistoryRunEventRecord[],
  options: { mode?: InspectionMode; width?: number } = {}
): string {
  const mode = options.mode ?? 'summary';
  const width = Math.max(40, options.width ?? 100);
  const outcome = `${run.status}${run.terminalReason ? ` (${run.terminalReason})` : ''}`;
  const lines = [
    `Outcome: ${outcome}${run.durationMs === undefined ? '' : ` in ${formatDuration(run.durationMs)}`}`,
  ];
  const phases = phaseSummary(events);
  if (phases) lines.push(`Phases: ${phases}`);
  lines.push(`Files: ${changedFileCount(run)} changed`);
  lines.push(`Validation: ${verificationSummary(run, events)}`);
  const response = responseObject(run);
  if (typeof response?.residualRisk === 'string') lines.push(`Residual risk: ${boundDisplayText(response.residualRisk, width).text}`);
  const failure = lastFailure(events);
  if (failure) lines.push(`Last failure: ${failure}`);
  lines.push(`Receipt: ${run.id}`);
  lines.push(`Inspect: karl history ${run.id} --events`);

  if (mode !== 'summary') {
    const commandEvents = events.filter((event) => event.type === 'tool_started' || event.type === 'tool_finished' || event.type === 'phase_finished');
    if (commandEvents.length) {
      lines.push('Details:');
      for (const event of commandEvents) {
        const detail = boundDisplayText(JSON.stringify(event.payload ?? {}), mode === 'trace' ? 1000 : Math.max(40, width - 30)).text;
        lines.push(`  ${event.sequence}. ${event.type}${event.toolName ? ` ${event.toolName}` : ''}${event.success === undefined ? '' : event.success ? ' ok' : ' failed'} ${detail}`);
      }
    }
  }
  if (mode === 'trace') lines.push('Trace is redacted and bounded at journal write time.');
  return lines.join('\n');
}

function sumTokens(results: TaskResult[]): TokenUsage | undefined {
  let totalInput = 0;
  let totalOutput = 0;
  let total = 0;
  let totalCost = 0;
  let has = false;

  for (const result of results) {
    if (!result.tokens) {
      continue;
    }
    has = true;
    totalInput += result.tokens.input ?? 0;
    totalOutput += result.tokens.output ?? 0;
    total += result.tokens.total ?? 0;
    totalCost += result.tokens.cost ?? 0;
  }

  if (!has) {
    return undefined;
  }

  return {
    input: totalInput || undefined,
    output: totalOutput || undefined,
    total: total || undefined,
    cost: totalCost || undefined
  };
}

function formatResultBody(result: TaskResult): string {
  if (result.status === 'error') {
    return `Error: ${result.error ?? 'Unknown error'}`;
  }
  return result.result ?? '';
}

function formatTools(result: TaskResult): string {
  if (result.toolsUsed.length === 0) {
    return 'Tools: none';
  }
  return `Tools: ${result.toolsUsed.join(', ')}`;
}

export function printResults(results: TaskResult[], options: PrintOptions): void {
  if (options.json) {
    const summaryTokens = sumTokens(results);
    const summary = {
      total: results.length,
      succeeded: results.filter((r) => r.status === 'success').length,
      failed: results.filter((r) => r.status === 'error').length,
      tokens: summaryTokens
    };

    const payload = {
      results: results.map((result) => ({
        task: result.task,
        status: result.status,
        result: result.result,
        error: result.error,
        tokens: result.tokens,
        duration_ms: result.durationMs,
        tools_used: result.toolsUsed
      })),
      summary,
      history_id: options.historyId
    };
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const multi = results.length > 1;
  results.forEach((result, index) => {
    if (multi) {
      console.log(`\x1b[1mTask ${index + 1}/${results.length}:\x1b[0m \x1b[2m${result.task.slice(0, 80)}${result.task.length > 80 ? '...' : ''}\x1b[0m`);
      console.log('');
    }
    console.log(formatResultBody(result));

    if (options.verbose) {
      console.log(formatTools(result));
      console.log(`Duration: ${formatDuration(result.durationMs)}`);
      if (result.tokens) {
        console.log(`Tokens: ${JSON.stringify(result.tokens)}`);
      }
    }

    if (index < results.length - 1) {
      console.log('');
    }
  });

  if (options.stats && results.length > 1) {
    const summaryTokens = sumTokens(results);
    const succeeded = results.filter((r) => r.status === 'success').length;
    const failed = results.length - succeeded;
    const totalDuration = results.reduce((sum, result) => sum + result.durationMs, 0);
    console.log('');
    console.log('\x1b[1m\x1b[36mSummary\x1b[0m');
    console.log(`  \x1b[2mTasks:\x1b[0m ${results.length}  \x1b[2mSucceeded:\x1b[0m ${succeeded}  \x1b[2mFailed:\x1b[0m ${failed}`);
    console.log(`  \x1b[2mTotal time:\x1b[0m ${formatDuration(totalDuration)}`);
    if (summaryTokens) {
      console.log(`  \x1b[2mTokens:\x1b[0m ${JSON.stringify(summaryTokens)}`);
    }
  }

  if (options.historyId && process.stderr.isTTY) {
    const changed = new Set((options.diffs ?? []).map((diff) => diff.path)).size;
    const result = results[results.length - 1];
    process.stderr.write(`Receipt: ${options.historyId} · ${result.status} · ${formatDuration(result.durationMs)} · ${changed} file(s) changed · validation not recorded\n`);
    process.stderr.write(`Inspect: karl history ${options.historyId} --events${options.trace ? ' --full' : ''}\n`);
  }
}
