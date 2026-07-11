/**
 * Mini TUI progress display for CLI
 * Tennis-themed flipbook animation - slow, charming scenes
 */

// Flipbook scenes - each is a multi-line ASCII art frame
// Displayed slowly like a comic strip while working
// All frames must be exactly 5 lines to prevent jumping
// Removed ASCII art flipbook for clean, borderless display

// const SPINNER_FRAMES = ['◐', '◓', '◑', '◒'];

function getTerminalWidth(): number {
  return process.stderr.columns || 80;
}

interface ToolCall {
  name: string;
  detail: string;
  status: 'running' | 'done' | 'error';
}

import pc from 'picocolors';
import type { VisualsMode } from './utils/visuals.js';
import { detectVisuals, SPINNER_STYLES } from './utils/visuals.js';

export class Spinner {
  private mode: VisualsMode;
  private interval: ReturnType<typeof setInterval> | null = null;
  private frameIndex = 0;
  private message = '';
  private enabled: boolean;
  private verbose: boolean;
  private startTime: number = 0;
  private toolCalls: ToolCall[] = [];
  private lines = 0;

  constructor(enabled = true, verbose = false, override: string | undefined = undefined) {
    this.verbose = verbose;
    this.mode = detectVisuals(override);
    // In verbose mode, we don't need TTY - we just stream text
    this.enabled = verbose || (enabled && process.stderr.isTTY === true);
  }

  start(message: string): void {
    if (!this.enabled) return;

    this.message = message;
    this.frameIndex = 0;
    this.startTime = Date.now();
    this.toolCalls = [];

    if (this.verbose) {
      // In verbose mode, just print a header
      const header = message || 'karl is on it...';
      process.stderr.write(`\n\x1b[1m● ${header}\x1b[0m\n\n`);
      return;
    }

    this.render();

    this.interval = setInterval(() => {
      this.frameIndex++;
      this.render();
    }, 600);  // Slow flipbook pace
  }

  update(message: string): void {
    if (!this.enabled) return;
    this.message = message;
    this.render();
  }

  setThinking(_text: string): void {
    if (!this.enabled) return;
    // Model reasoning is journal metadata, not terminal output. Tool and phase
    // events provide the operator-facing progress surface.
  }

  toolStart(name: string, detail: string = ''): void {
    if (!this.enabled) return;

    if (this.verbose) {
      // In verbose mode, print tool call on its own line
      const boundedDetail = detail.length > 500 ? `${detail.slice(0, 497)}...` : detail;
      const detailStr = boundedDetail ? ` \x1b[2m${boundedDetail}\x1b[0m` : '';
      process.stderr.write(`\n\x1b[36m▸ ${name}\x1b[0m${detailStr}\n`);
      return;
    }

    this.toolCalls.push({ name, detail, status: 'running' });
    // Keep last 3 tool calls
    if (this.toolCalls.length > 3) {
      this.toolCalls.shift();
    }
    this.render();
  }

  toolEnd(name: string, success: boolean): void {
    if (!this.enabled) return;

    if (this.verbose) {
      // In verbose mode, print result
      const icon = success ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
      process.stderr.write(`  ${icon} ${name} done\n`);
      return;
    }

    const tool = this.toolCalls.find(t => t.name === name && t.status === 'running');
    if (tool) {
      tool.status = success ? 'done' : 'error';
    }
    this.render();
  }

  private clearLines(): void {
    process.stderr.write(`\r\x1b[2K`);
  }

  private render(): void {
    if (this.mode.spinner === 'none') return;

    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    const frames = SPINNER_STYLES[this.mode.spinner];
    const spinner = frames[this.frameIndex % frames.length];

    const termWidth = getTerminalWidth();
    
    let statusLine = `${pc.cyan(spinner)} ${pc.bold(this.message || 'karl is on it...')} ${pc.dim(`(${elapsed}s)`)}`;

    if (this.toolCalls.length > 0) {
      const recentTool = this.toolCalls.slice(-1)[0];
      const icon = recentTool.status === 'running' ? pc.cyan('▸') : 
                   recentTool.status === 'done' ? pc.green('✓') : pc.red('✗');
      statusLine += ` ${icon} ${pc.dim(recentTool.name.slice(0, 20))}`;
    }

    const stripped = stripAnsi(statusLine);
    if (stripped.length > termWidth - 1) {
      statusLine = statusLine.slice(0, (termWidth * 1.3)) + pc.dim('...');
    }

    process.stderr.write(`\r\x1b[2K${statusLine}`);
    this.lines = 1;
  }

  /** Print a persistent line above the spinner (default mode only) */
  log(text: string): void {
    if (!this.enabled || this.verbose) return;
    if (this.mode.spinner === 'none') return;
    // Clear spinner line, print log, re-render spinner below
    process.stderr.write(`\r\x1b[2K${text}\n`);
    this.render();
  }

  stop(finalMessage?: string): void {
    if (!this.enabled) return;

    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    this.clearLines();
    process.stderr.write('\n');

    if (this.verbose) {
      const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
      process.stderr.write(`${pc.dim(`── done in ${elapsed}s ──`)}\n\n`);
      return;
    }

    if (finalMessage) {
      process.stderr.write(`${finalMessage}\n`);
    }
  }
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Format tool name for display
 */
export function formatToolTrace(tool: string, status: 'start' | 'end', success?: boolean): string {
  const icon = status === 'start' ? '▸' : (success ? '✓' : '✗');
  return `${icon} ${tool}`;
}
