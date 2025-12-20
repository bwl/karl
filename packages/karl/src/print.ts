import { TaskResult, TokenUsage } from './types.js';
import { formatDuration } from './utils.js';

interface PrintOptions {
  json?: boolean;
  verbose?: boolean;
  stats?: boolean;
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
      summary
    };
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const multi = results.length > 1;
  results.forEach((result, index) => {
    if (multi) {
      console.log(`=== ${index + 1}/${results.length}: ${result.task} ===`);
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
    console.log('=== Summary ===');
    console.log(`Tasks: ${results.length}  Succeeded: ${succeeded}  Failed: ${failed}`);
    console.log(`Total time: ${formatDuration(totalDuration)}`);
    if (summaryTokens) {
      console.log(`Tokens: ${JSON.stringify(summaryTokens)}`);
    }
  }
}
