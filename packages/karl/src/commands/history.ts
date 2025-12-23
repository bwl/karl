import { loadConfig } from '../config.js';
import { createHistoryStore, type HistoryListOptions, type HistoryRunRecord, type HistoryRunSummary } from '../history.js';
import { formatDuration } from '../utils.js';

function parseTimeArg(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsedDate = Date.parse(trimmed);
  if (!Number.isNaN(parsedDate)) {
    return parsedDate;
  }
  const match = trimmed.match(/^([0-9]+(?:\.[0-9]+)?)(ms|s|m|h|d)$/);
  if (!match) {
    return null;
  }
  const amount = Number(match[1]);
  const unit = match[2];
  if (!Number.isFinite(amount)) {
    return null;
  }
  const unitMs = unit === 'ms'
    ? 1
    : unit === 's'
      ? 1000
      : unit === 'm'
        ? 60_000
        : unit === 'h'
          ? 3_600_000
          : 86_400_000;
  return Date.now() - Math.round(amount * unitMs);
}

function formatSummary(summary: HistoryRunSummary): string {
  const when = new Date(summary.createdAt).toISOString();
  const duration = summary.durationMs ? formatDuration(summary.durationMs) : '-';
  const meta = [summary.modelKey, summary.stack, summary.skill].filter(Boolean).join(' ');
  const prompt = summary.prompt.replace(/\s+/g, ' ');
  const shortPrompt = prompt.length > 80 ? `${prompt.slice(0, 80)}...` : prompt;
  return `${summary.id}  ${when}  ${summary.status}  ${meta || '-'}  ${duration}  ${shortPrompt}`;
}

function printRun(run: HistoryRunRecord, full: boolean): void {
  console.log(`ID:        ${run.id}`);
  console.log(`Date:      ${new Date(run.createdAt).toISOString()}`);
  console.log(`Status:    ${run.status}`);
  if (run.durationMs !== undefined) {
    console.log(`Duration:  ${formatDuration(run.durationMs)}`);
  }
  if (run.modelKey || run.modelId) {
    console.log(`Model:     ${run.modelKey ?? ''}${run.modelId ? ` (${run.modelId})` : ''}`);
  }
  if (run.providerKey) {
    console.log(`Provider:  ${run.providerKey}`);
  }
  if (run.stack) {
    console.log(`Stack:     ${run.stack}`);
  }
  if (run.skill) {
    console.log(`Skill:     ${run.skill}`);
  }
  if (run.tags && run.tags.length > 0) {
    console.log(`Tags:      ${run.tags.join(', ')}`);
  }
  if (run.parentId) {
    console.log(`Parent:    ${run.parentId}`);
  }
  console.log('');
  console.log('Prompt:');
  console.log(run.prompt);
  console.log('');
  console.log('Response:');
  console.log(run.response ?? '');
  if (run.error) {
    console.log('');
    console.log('Error:');
    console.log(run.error);
  }

  if (run.diffs && run.diffs.length > 0) {
    console.log('');
    console.log(`Diffs: ${run.diffs.length}`);
    for (const diff of run.diffs) {
      console.log(`- ${diff.path} (${diff.tool})${diff.truncated ? ' [truncated]' : ''}`);
    }
  }

  if (full) {
    if (run.thinking && run.thinking.length > 0) {
      console.log('');
      console.log('Thinking:');
      for (const entry of run.thinking) {
        console.log(`[${new Date(entry.ts).toISOString()}] ${entry.text}`);
      }
    }
    if (run.contextFilePath) {
      console.log('');
      console.log(`Context File: ${run.contextFilePath}`);
    }
    if (run.contextFileRaw) {
      console.log('');
      console.log('Context File Raw:');
      console.log(run.contextFileRaw);
    }
    if (run.contextInline) {
      console.log('');
      console.log('Context Inline:');
      console.log(run.contextInline);
    }
    if (run.systemPrompt) {
      console.log('');
      console.log('System Prompt:');
      console.log(run.systemPrompt);
    }
  }
}

export async function handleHistoryCommand(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const config = await loadConfig(cwd);
  const store = createHistoryStore(config.history, cwd);
  if (!store) {
    console.error('History is disabled.');
    process.exitCode = 1;
    return;
  }

  const options: HistoryListOptions = {};
  let json = false;
  let full = false;
  let responseOnly = false;
  let id: string | undefined;

  const requireValue = (name: string, value: string | undefined): string => {
    if (!value) {
      throw new Error(`Missing value for ${name}`);
    }
    return value;
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--json' || arg === '-j') {
      json = true;
      continue;
    }
    if (arg === '--full') {
      full = true;
      continue;
    }
    if (arg === '--response') {
      responseOnly = true;
      continue;
    }
    if (arg === '--limit') {
      const limitValue = Number(requireValue(arg, args[++i]));
      if (!Number.isFinite(limitValue) || limitValue < 1) {
        throw new Error(`Invalid --limit value: ${args[i]}`);
      }
      options.limit = limitValue;
      continue;
    }
    if (arg === '--since') {
      const parsed = parseTimeArg(requireValue(arg, args[++i]));
      if (parsed === null) {
        throw new Error(`Invalid --since value: ${args[i]}`);
      }
      options.since = parsed;
      continue;
    }
    if (arg === '--until') {
      const parsed = parseTimeArg(requireValue(arg, args[++i]));
      if (parsed === null) {
        throw new Error(`Invalid --until value: ${args[i]}`);
      }
      options.until = parsed;
      continue;
    }
    if (arg === '--tag') {
      const tag = requireValue(arg, args[++i]);
      if (!options.tag) {
        options.tag = [];
      }
      options.tag.push(tag);
      continue;
    }
    if (arg === '--status') {
      const status = requireValue(arg, args[++i]);
      if (status !== 'success' && status !== 'error') {
        throw new Error(`Invalid status: ${status}`);
      }
      options.status = status;
      continue;
    }
    if (arg === '--stack') {
      options.stack = requireValue(arg, args[++i]);
      continue;
    }
    if (arg === '--model') {
      options.model = requireValue(arg, args[++i]);
      continue;
    }
    if (arg === '--skill') {
      options.skill = requireValue(arg, args[++i]);
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown flag: ${arg}`);
    }
    if (!id) {
      id = arg;
      continue;
    }
    throw new Error(`Unexpected argument: ${arg}`);
  }

  if (id) {
    const run = store.getRunById(id);
    if (!run) {
      console.error(`History entry not found: ${id}`);
      process.exitCode = 1;
      return;
    }
    if (responseOnly) {
      console.log(run.response ?? '');
      return;
    }
    if (json) {
      console.log(JSON.stringify(run, null, 2));
      return;
    }
    printRun(run, full);
    return;
  }

  const runs = store.listRuns(options);
  if (json) {
    console.log(JSON.stringify(runs, null, 2));
    return;
  }
  if (runs.length === 0) {
    console.log('No history entries found.');
    return;
  }
  for (const run of runs) {
    console.log(formatSummary(run));
  }
}
