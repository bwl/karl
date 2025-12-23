/**
 * Status file writer for live task progress
 * Writes to .karl/status.json so orchestrators can monitor progress
 */

import { mkdirSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';

export interface TaskStatus {
  task: string;
  taskId?: string;
  status: 'starting' | 'running' | 'completed' | 'error';
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  currentTool?: string;
  currentFile?: string;
  thinking?: string;
  toolsUsed: string[];
  toolsCompleted: number;
  durationMs?: number;
  error?: string;
}

export class StatusWriter {
  private statusPath: string;
  private mainStatusPath?: string;
  private writeMainStatus: boolean = false;
  private status: TaskStatus;

  constructor(cwd: string, task: string, taskId?: string) {
    const karlDir = join(cwd, '.karl');
    if (!existsSync(karlDir)) {
      mkdirSync(karlDir, { recursive: true });
    }

    // Check if running as a background job
    const jobId = process.env.KARL_JOB_ID;
    if (jobId) {
      // Write to job-specific status file
      const jobDir = join(karlDir, 'jobs', jobId);
      if (!existsSync(jobDir)) {
        mkdirSync(jobDir, { recursive: true });
      }
      this.statusPath = join(jobDir, 'status.json');
    } else if (taskId) {
      // Write to task-specific status file for foreground tasks
      const statusDir = join(karlDir, 'status');
      if (!existsSync(statusDir)) {
        mkdirSync(statusDir, { recursive: true });
      }
      this.statusPath = join(statusDir, `${taskId}.json`);
      // Also write to main status.json for easy access (foreground only)
      this.writeMainStatus = true;
      this.mainStatusPath = join(karlDir, 'status.json');
    } else {
      // Fallback to main status.json
      this.statusPath = join(karlDir, 'status.json');
    }

    const now = new Date().toISOString();
    this.status = {
      task: task.length > 200 ? task.slice(0, 200) + '...' : task,
      taskId,
      status: 'starting',
      startedAt: now,
      updatedAt: now,
      toolsUsed: [],
      toolsCompleted: 0
    };
    this.write();
  }

  onThinking(text: string): void {
    // Truncate thinking to last meaningful chunk
    const truncated = text.length > 500 ? '...' + text.slice(-500) : text;
    this.status.thinking = truncated;
    this.status.status = 'running';
    this.status.updatedAt = new Date().toISOString();
    this.write();
  }

  onToolStart(tool: string, detail?: string): void {
    this.status.currentTool = tool;
    this.status.currentFile = detail;
    this.status.status = 'running';
    this.status.updatedAt = new Date().toISOString();
    if (!this.status.toolsUsed.includes(tool)) {
      this.status.toolsUsed.push(tool);
    }
    this.write();
  }

  onToolEnd(tool: string, success: boolean): void {
    this.status.toolsCompleted++;
    this.status.currentTool = undefined;
    this.status.currentFile = undefined;
    this.status.updatedAt = new Date().toISOString();
    this.write();
  }

  onComplete(durationMs: number): void {
    this.status.status = 'completed';
    this.status.completedAt = new Date().toISOString();
    this.status.updatedAt = this.status.completedAt;
    this.status.durationMs = durationMs;
    this.status.currentTool = undefined;
    this.status.thinking = undefined;
    this.write();
  }

  onError(error: string, durationMs: number): void {
    this.status.status = 'error';
    this.status.error = error;
    this.status.completedAt = new Date().toISOString();
    this.status.updatedAt = this.status.completedAt;
    this.status.durationMs = durationMs;
    this.status.currentTool = undefined;
    this.write();
  }

  private write(): void {
    try {
      const content = JSON.stringify(this.status, null, 2) + '\n';
      writeFileSync(this.statusPath, content);
      // Also write to main status.json for foreground tasks (easy access)
      if (this.writeMainStatus && this.mainStatusPath) {
        writeFileSync(this.mainStatusPath, content);
      }
    } catch {
      // Silently fail - status is nice-to-have, not critical
    }
  }

  clear(): void {
    try {
      if (existsSync(this.statusPath)) {
        unlinkSync(this.statusPath);
      }
    } catch {
      // Silently fail
    }
  }
}
