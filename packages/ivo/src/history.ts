import { spawn } from 'child_process';
import type { ContextHistory, ContextHistoryEntry, ContextHistoryOptions } from './types.js';

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function getKarlCommand(): string {
  return process.env.KARL_BIN || 'karl';
}

async function execCommand(cmd: string, args: string[], cwd: string): Promise<ExecResult> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    proc.on('error', (error) => {
      resolve({ stdout: '', stderr: error.message, exitCode: 127 });
    });
  });
}

export async function loadHistoryContext(
  options: ContextHistoryOptions | undefined,
  cwd: string
): Promise<ContextHistory | null> {
  if (!options) {
    return null;
  }

  const karlCommand = getKarlCommand();
  const historyArgs = buildHistoryArgs(options);
  const historyResult = await execCommand(karlCommand, historyArgs, cwd);
  if (historyResult.exitCode !== 0) {
    const message = historyResult.stderr || historyResult.stdout || 'Unknown error';
    throw new Error(`History command failed: ${message.trim()}`);
  }

  const parsed = parseJsonOutput(historyResult.stdout);
  if (!parsed) {
    return null;
  }

  let entries = Array.isArray(parsed) ? parsed : [parsed];
  let mode: ContextHistory['mode'] = options.id ? 'full' : 'summary';

  if (options.full && !options.id && entries.length > 0) {
    const fullEntries: ContextHistoryEntry[] = [];
    for (const entry of entries) {
      const id = String(entry.id || '').trim();
      if (!id) continue;
      const fullResult = await execCommand(
        karlCommand,
        ['history', id, '--json'],
        cwd
      );
      if (fullResult.exitCode !== 0) {
        continue;
      }
      const fullParsed = parseJsonOutput(fullResult.stdout);
      if (fullParsed && !Array.isArray(fullParsed)) {
        fullEntries.push(fullParsed as ContextHistoryEntry);
      }
    }
    if (fullEntries.length > 0) {
      entries = fullEntries;
      mode = 'full';
    }
  }

  return {
    source: 'karl',
    mode,
    entries,
  };
}

function buildHistoryArgs(options: ContextHistoryOptions): string[] {
  if (options.id) {
    return ['history', options.id, '--json'];
  }

  const args = ['history', '--json'];
  const limit = options.limit && options.limit > 0 ? options.limit : 1;
  args.push('--limit', String(limit));

  if (options.tag && options.tag.length > 0) {
    for (const tag of options.tag) {
      args.push('--tag', tag);
    }
  }
  if (options.status) {
    args.push('--status', options.status);
  }
  if (options.stack) {
    args.push('--stack', options.stack);
  }
  if (options.model) {
    args.push('--model', options.model);
  }
  if (options.skill) {
    args.push('--skill', options.skill);
  }

  return args;
}

function parseJsonOutput(output: string): ContextHistoryEntry[] | ContextHistoryEntry | null {
  const trimmed = output.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('No history entries')) return null;
  try {
    return JSON.parse(trimmed) as ContextHistoryEntry[] | ContextHistoryEntry;
  } catch {
    return null;
  }
}
