/**
 * Background job management for karl
 * Tracks running tasks, their PIDs, output logs, and status
 */

import { spawn } from 'child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, openSync, closeSync } from 'fs';
import { join } from 'path';

export interface JobMeta {
  id: string;
  pid: number;
  task: string;
  command: string;
  cwd: string;
  startedAt: string;
  status: 'running' | 'completed' | 'error';
  exitCode?: number;
  completedAt?: string;
}

export interface JobInfo extends JobMeta {
  outputPath: string;
  statusPath: string;
}

function getJobsDir(cwd: string): string {
  return join(cwd, '.karl', 'jobs');
}

function ensureJobsDir(cwd: string): string {
  const jobsDir = getJobsDir(cwd);
  if (!existsSync(jobsDir)) {
    mkdirSync(jobsDir, { recursive: true });
  }
  return jobsDir;
}

function generateJobId(): string {
  const now = new Date();
  const ts = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 6);
  return `job_${ts}_${rand}`;
}

export function launchBackgroundJob(
  cwd: string,
  task: string,
  args: string[],
  stdin?: string
): { jobId: string; pid: number } {
  const jobsDir = ensureJobsDir(cwd);
  const jobId = generateJobId();
  const jobDir = join(jobsDir, jobId);
  mkdirSync(jobDir, { recursive: true });

  const outputPath = join(jobDir, 'output.log');
  const metaPath = join(jobDir, 'meta.json');

  // Build the command - re-run karl without --background
  const karlPath = process.argv[1];
  const filteredArgs: string[] = [];
  const valueFlags = new Set([
    '--model', '-m', '--provider', '--max-tokens', '--reasoning-effort', '--timeout',
    '--skill', '--context', '--context-file', '--parent', '--follow-up', '--followup',
    '--chain', '--tag', '--visuals', '--stack',
  ]);
  let positionalOnly = false;
  let nextIsValue = false;
  for (const arg of args) {
    if (nextIsValue) {
      filteredArgs.push(arg);
      nextIsValue = false;
      continue;
    }
    if (arg === '--') positionalOnly = true;
    const flag = arg.split('=')[0];
    if (!positionalOnly && ['--background', '-bg', '--bg', '--detach'].includes(flag)) continue;
    filteredArgs.push(arg);
    nextIsValue = !positionalOnly && valueFlags.has(arg);
  }

  // Persist stdin in the job directory, not argv (large inputs exceed OS limits).
  const inputPath = join(jobDir, 'stdin.txt');
  if (stdin !== undefined) writeFileSync(inputPath, stdin, { mode: 0o600 });
  const inputFd = stdin === undefined ? undefined : openSync(inputPath, 'r');
  const outputFd = openSync(outputPath, 'a', 0o600);
  const compiled = karlPath === process.execPath || karlPath?.startsWith('/$bunfs/');

  // Spawn karl as detached process
  let child;
  try {
    child = spawn(process.execPath, compiled ? filteredArgs : [karlPath, ...filteredArgs], {
      cwd,
      detached: true,
      stdio: [inputFd ?? 'ignore', outputFd, outputFd],
      env: { ...process.env, KARL_JOB_ID: jobId }
    });
  } finally {
    if (inputFd !== undefined) closeSync(inputFd);
    closeSync(outputFd);
  }

  // Write initial metadata
  const meta: JobMeta = {
    id: jobId,
    pid: child.pid ?? 0,
    task: task.length > 200 ? task.slice(0, 200) + '...' : task,
    command: `karl ${filteredArgs.join(' ')}`,
    cwd,
    startedAt: new Date().toISOString(),
    status: child.pid ? 'running' : 'error'
  };
  writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');

  child.on('error', () => finishBackgroundJob(cwd, jobId, 1));

  // The child records completion itself after the launching process exits.
  child.unref();

  if (!child.pid) throw new Error(`Could not start background job ${jobId}`);
  return { jobId, pid: child.pid };
}

export function finishBackgroundJob(cwd: string, jobId: string, exitCode: number): void {
  if (!/^job_[a-zA-Z0-9_]+$/.test(jobId)) return;
  const metaPath = join(getJobsDir(cwd), jobId, 'meta.json');
  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as JobMeta;
    // A nested Karl command can inherit KARL_JOB_ID; only the worker owns it.
    if (meta.pid && meta.pid !== process.pid) return;
    writeFileSync(metaPath, JSON.stringify({
      ...meta, status: exitCode === 0 ? 'completed' : 'error', exitCode,
      completedAt: new Date().toISOString(),
    }, null, 2) + '\n');
  } catch {
    // A missing/unwritable job receipt must not replace the task's result.
  }
}

export function listJobs(cwd: string): JobInfo[] {
  const jobsDir = getJobsDir(cwd);
  if (!existsSync(jobsDir)) {
    return [];
  }

  const jobs: JobInfo[] = [];
  const entries = readdirSync(jobsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('job_')) {
      continue;
    }

    const jobDir = join(jobsDir, entry.name);
    const metaPath = join(jobDir, 'meta.json');
    const outputPath = join(jobDir, 'output.log');
    const statusPath = join(cwd, '.karl', 'status.json');

    if (!existsSync(metaPath)) {
      continue;
    }

    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as JobMeta;

      // Check if process is still running
      if (meta.status === 'running') {
        try {
          process.kill(meta.pid, 0); // Signal 0 = just check if exists
        } catch {
          // Process no longer exists, mark as completed/error
          meta.status = 'error';
          meta.completedAt = new Date().toISOString();
          writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
        }
      }

      jobs.push({
        ...meta,
        outputPath,
        statusPath
      });
    } catch {
      // Skip invalid job entries
    }
  }

  // Sort by start time, newest first
  jobs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return jobs;
}

export function getJob(cwd: string, jobId: string): JobInfo | null {
  const jobsDir = getJobsDir(cwd);
  const jobDir = join(jobsDir, jobId);
  const metaPath = join(jobDir, 'meta.json');

  if (!existsSync(metaPath)) {
    // Try to find by prefix
    if (!existsSync(jobsDir)) return null;
    const entries = readdirSync(jobsDir);
    const match = entries.find(e => e.startsWith(jobId) || e.includes(jobId));
    if (!match) return null;
    return getJob(cwd, match);
  }

  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as JobMeta;
    return {
      ...meta,
      outputPath: join(jobDir, 'output.log'),
      statusPath: join(cwd, '.karl', 'status.json')
    };
  } catch {
    return null;
  }
}

export function getJobLogs(cwd: string, jobId: string, tail?: number): string | null {
  const job = getJob(cwd, jobId);
  if (!job || !existsSync(job.outputPath)) {
    return null;
  }

  const content = readFileSync(job.outputPath, 'utf-8');
  if (tail && tail > 0) {
    const lines = content.split('\n');
    return lines.slice(-tail).join('\n');
  }
  return content;
}

export function cleanupOldJobs(cwd: string, maxAgeDays: number = 7): number {
  const jobsDir = getJobsDir(cwd);
  if (!existsSync(jobsDir)) return 0;

  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  let cleaned = 0;

  const entries = readdirSync(jobsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('job_')) continue;

    const jobDir = join(jobsDir, entry.name);
    const metaPath = join(jobDir, 'meta.json');

    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as JobMeta;
      const completedAt = meta.completedAt ? new Date(meta.completedAt).getTime() : 0;

      if (meta.status !== 'running' && completedAt < cutoff) {
        // Remove job directory
        const { rmSync } = require('fs');
        rmSync(jobDir, { recursive: true });
        cleaned++;
      }
    } catch {
      // Skip
    }
  }

  return cleaned;
}
