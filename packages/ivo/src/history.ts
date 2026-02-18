/**
 * Git History — loads recent commit history via git log
 */

import { spawn } from 'child_process';
import type { ContextHistory, ContextHistoryEntry, ContextHistoryOptions } from './types.js';

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
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
  if (!options) return null;

  const limit = options.limit && options.limit > 0 ? options.limit : 10;

  // Build git log arguments
  const args = [
    'log',
    `--max-count=${limit}`,
    '--format=%H%x00%ai%x00%s%x00%b%x00',
  ];

  const result = await execCommand('git', args, cwd);
  if (result.exitCode !== 0) return null;

  const entries = parseGitLog(result.stdout);
  if (entries.length === 0) return null;

  return {
    source: 'git',
    mode: options.full ? 'full' : 'summary',
    entries,
  };
}

function parseGitLog(output: string): ContextHistoryEntry[] {
  const entries: ContextHistoryEntry[] = [];
  const raw = output.trim();
  if (!raw) return entries;

  // Split on the record separator (double null from %x00 at end + next record)
  const records = raw.split('\0\n').filter(Boolean);

  for (const record of records) {
    const parts = record.split('\0');
    if (parts.length < 3) continue;

    const [hash, date, subject, body] = parts;
    entries.push({
      id: hash?.trim(),
      createdAt: date ? new Date(date.trim()).getTime() : undefined,
      status: 'success',
      prompt: subject?.trim(),
      response: body?.trim() || undefined,
    });
  }

  return entries;
}
