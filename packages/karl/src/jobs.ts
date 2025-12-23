/**
 * Background job management for karl
 * Tracks running tasks, their PIDs, output logs, and status
 */

import { spawn, type ChildProcess } from 'child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync, createWriteStream } from 'fs';
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
  args: string[]
): { jobId: string; pid: number } {
  const jobsDir = ensureJobsDir(cwd);
  const jobId = generateJobId();
  const jobDir = join(jobsDir, jobId);
  mkdirSync(jobDir, { recursive: true });

  const outputPath = join(jobDir, 'output.log');
  const metaPath = join(jobDir, 'meta.json');

  // Create output file stream
  const outputStream = createWriteStream(outputPath, { flags: 'a' });

  // Build the command - re-run karl without --background
  const karlPath = process.argv[1];
  const filteredArgs = args.filter(a => a !== '--background' && a !== '-bg');

  // Spawn karl as detached process
  const child = spawn(process.execPath, [karlPath, ...filteredArgs], {
    cwd,
    detached: true,
    stdio: ['ignore', outputStream, outputStream],
    env: { ...process.env, KARL_JOB_ID: jobId }
  });

  // Write initial metadata
  const meta: JobMeta = {
    id: jobId,
    pid: child.pid!,
    task: task.length > 200 ? task.slice(0, 200) + '...' : task,
    command: `karl ${filteredArgs.join(' ')}`,
    cwd,
    startedAt: new Date().toISOString(),
    status: 'running'
  };
  writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');

  // Monitor for completion
  child.on('exit', (code) => {
    try {
      const updatedMeta: JobMeta = {
        ...meta,
        status: code === 0 ? 'completed' : 'error',
        exitCode: code ?? undefined,
        completedAt: new Date().toISOString()
      };
      writeFileSync(metaPath, JSON.stringify(updatedMeta, null, 2) + '\n');
    } catch {
      // Ignore errors writing final status
    }
    outputStream.close();
  });

  // Unref so parent can exit
  child.unref();
  outputStream.unref?.();

  return { jobId, pid: child.pid! };
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
