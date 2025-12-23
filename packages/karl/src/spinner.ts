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
  private thinking: string[] = [];  // Lines of thinking text
  private lines = 0;
  private lastThinkingText = '';  // Track what we've already printed in verbose mode

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
    this.lastThinkingText = '';

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

  setThinking(text: string): void {
    if (!this.enabled) return;

    if (this.verbose) {
      // In verbose mode, stream new thinking text as it arrives
      if (text.length > this.lastThinkingText.length && text.startsWith(this.lastThinkingText)) {
        const newText = text.slice(this.lastThinkingText.length);
        process.stderr.write(`${pc.dim(newText)}`);
      } else if (text !== this.lastThinkingText) {
        process.stderr.write(`${pc.dim(text)}`);
      }
      this.lastThinkingText = text;
      return;
    }

    // Single line last thinking
    const maxWidth = getTerminalWidth() - 20;
    const lines = text.split('\n').slice(-1);
    this.thinking = lines.map(l => truncate(l.trim(), maxWidth));
    this.render();
  }

  toolStart(name: string, detail: string = ''): void {
    if (!this.enabled) return;

    if (this.verbose) {
      // In verbose mode, print tool call on its own line
      const detailStr = detail ? ` \x1b[2m${detail}\x1b[0m` : '';
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

    if (this.thinking.length > 0) {
      const thinkText = this.thinking.slice(-1)[0] || '';
      statusLine += ` ${pc.dim('∴')} ${pc.dim(thinkText.slice(0, termWidth / 2))}`;
    }

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

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + '...';
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
