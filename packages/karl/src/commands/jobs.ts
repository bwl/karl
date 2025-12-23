/**
 * CLI commands for managing background jobs
 */

import { existsSync, readFileSync } from 'fs';
import { listJobs, getJob, getJobLogs } from '../jobs.js';
import type { TaskStatus } from '../status.js';

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

function formatTimeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

export async function handleJobsCommand(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const subcommand = args[0];

  // Default: list jobs
  if (!subcommand || subcommand === 'list' || subcommand === 'ls') {
    const jobs = listJobs(cwd);

    if (jobs.length === 0) {
      console.log('No background jobs found.');
      console.log('');
      console.log('Start a job with: karl run "task" --background');
      return;
    }

    console.log('Background Jobs:\n');
    for (const job of jobs) {
      const statusIcon = job.status === 'running' ? '⏳' : job.status === 'completed' ? '✓' : '✗';
      const duration = job.completedAt
        ? formatDuration(new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime())
        : formatDuration(Date.now() - new Date(job.startedAt).getTime());
      const timeInfo = job.status === 'running' ? `running for ${duration}` : formatTimeAgo(job.completedAt || job.startedAt);

      console.log(`  ${statusIcon} ${job.id}`);
      console.log(`    Task: ${job.task}`);
      console.log(`    Status: ${job.status} (${timeInfo})`);
      if (job.exitCode !== undefined) {
        console.log(`    Exit: ${job.exitCode}`);
      }
      console.log('');
    }

    console.log(`Use 'karl status <id>' for live progress, 'karl logs <id>' for output.`);
    return;
  }

  // karl jobs clean - cleanup old jobs
  if (subcommand === 'clean' || subcommand === 'cleanup') {
    const { cleanupOldJobs } = await import('../jobs.js');
    const cleaned = cleanupOldJobs(cwd);
    console.log(`Cleaned up ${cleaned} old job(s).`);
    return;
  }

  console.error(`Unknown jobs subcommand: ${subcommand}`);
  console.error('Usage: karl jobs [list|clean]');
  process.exitCode = 1;
}

export async function handleStatusCommand(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const jobId = args[0];

  // If no job ID, show current status.json
  if (!jobId) {
    const statusPath = `${cwd}/.karl/status.json`;
    if (!existsSync(statusPath)) {
      console.log('No active task. Status file not found.');
      return;
    }

    try {
      const status = JSON.parse(readFileSync(statusPath, 'utf-8')) as TaskStatus;
      printStatus(status);
    } catch {
      console.error('Failed to read status file.');
      process.exitCode = 1;
    }
    return;
  }

  // Find job by ID
  const job = getJob(cwd, jobId);
  if (!job) {
    console.error(`Job not found: ${jobId}`);
    console.error('Use "karl jobs" to list available jobs.');
    process.exitCode = 1;
    return;
  }

  console.log(`Job: ${job.id}`);
  console.log(`Task: ${job.task}`);
  console.log(`Status: ${job.status}`);
  console.log(`Started: ${job.startedAt}`);
  if (job.completedAt) {
    console.log(`Completed: ${job.completedAt}`);
  }
  if (job.exitCode !== undefined) {
    console.log(`Exit Code: ${job.exitCode}`);
  }
  console.log('');

  // Try to read live status if job is running
  // First check job-specific status file, then fall back to global
  const jobStatusPath = job.outputPath.replace('output.log', 'status.json');
  const statusPathToRead = existsSync(jobStatusPath) ? jobStatusPath : job.statusPath;

  if (job.status === 'running' && existsSync(statusPathToRead)) {
    try {
      const liveStatus = JSON.parse(readFileSync(statusPathToRead, 'utf-8')) as TaskStatus;
      console.log('Live Progress:');
      printStatus(liveStatus, '  ');
    } catch {
      // Status file might not be ready yet
    }
  }
}

function printStatus(status: TaskStatus, indent: string = ''): void {
  console.log(`${indent}Status: ${status.status}`);
  if (status.currentTool) {
    console.log(`${indent}Current Tool: ${status.currentTool}`);
  }
  if (status.currentFile) {
    console.log(`${indent}Current File: ${status.currentFile}`);
  }
  console.log(`${indent}Tools Completed: ${status.toolsCompleted}`);
  if (status.toolsUsed.length > 0) {
    console.log(`${indent}Tools Used: ${status.toolsUsed.join(', ')}`);
  }
  if (status.thinking) {
    const truncated = status.thinking.length > 200 ? status.thinking.slice(-200) + '...' : status.thinking;
    console.log(`${indent}Thinking: ${truncated}`);
  }
  if (status.durationMs) {
    console.log(`${indent}Duration: ${formatDuration(status.durationMs)}`);
  }
}

export async function handleLogsCommand(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const jobId = args[0];
  const tailFlag = args.includes('--tail') || args.includes('-f');
  const tailLines = args.includes('-n') ? parseInt(args[args.indexOf('-n') + 1], 10) : undefined;

  if (!jobId) {
    console.error('Usage: karl logs <job-id> [--tail] [-n <lines>]');
    process.exitCode = 1;
    return;
  }

  const job = getJob(cwd, jobId);
  if (!job) {
    console.error(`Job not found: ${jobId}`);
    process.exitCode = 1;
    return;
  }

  if (!existsSync(job.outputPath)) {
    console.log('No output yet.');
    return;
  }

  const logs = getJobLogs(cwd, jobId, tailLines);
  if (logs === null) {
    console.error('Failed to read logs.');
    process.exitCode = 1;
    return;
  }

  console.log(logs);

  // If job is still running and --tail, watch for changes
  if (tailFlag && job.status === 'running') {
    console.log('\n--- Watching for new output (Ctrl+C to stop) ---\n');
    const { watchFile } = await import('fs');
    let lastSize = logs.length;

    watchFile(job.outputPath, { interval: 500 }, () => {
      try {
        const content = readFileSync(job.outputPath, 'utf-8');
        if (content.length > lastSize) {
          process.stdout.write(content.slice(lastSize));
          lastSize = content.length;
        }
      } catch {
        // Ignore
      }
    });

    // Keep process alive
    await new Promise(() => {});
  }
}
