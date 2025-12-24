/**
 * Status Bar for Agent REPL
 *
 * Renders a persistent status bar at the bottom of the terminal.
 * Uses ANSI escape sequences to maintain position.
 */

import pc from 'picocolors';
import { execSync } from 'child_process';

export interface StatusBarState {
  model: string;
  provider: string;
  tokens: number;
  contextPercent?: number;  // 0-100
  isProcessing: boolean;
  currentTool?: string;
}

/**
 * Get git branch and dirty status
 */
function getGitInfo(): { branch: string; dirty: boolean } | null {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD 2>/dev/null', {
      encoding: 'utf-8',
      timeout: 500,
    }).trim();

    // Check if dirty (has uncommitted changes)
    const status = execSync('git status --porcelain 2>/dev/null', {
      encoding: 'utf-8',
      timeout: 500,
    }).trim();

    return { branch, dirty: status.length > 0 };
  } catch {
    return null;
  }
}

/**
 * Format token count with K/M suffixes
 */
function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`;
  }
  return String(tokens);
}

/**
 * Format model name for display - just use as configured
 */
function formatModelName(model: string): string {
  return model;
}

export class StatusBar {
  private state: StatusBarState;
  private enabled: boolean;
  private lastRender = '';
  private gitInfo: { branch: string; dirty: boolean } | null = null;
  private gitCheckTime = 0;
  private refreshInterval: NodeJS.Timeout | null = null;
  private hidden = false;

  constructor(initialState: Partial<StatusBarState> = {}) {
    this.state = {
      model: initialState.model ?? 'unknown',
      provider: initialState.provider ?? 'unknown',
      tokens: initialState.tokens ?? 0,
      contextPercent: initialState.contextPercent,
      isProcessing: initialState.isProcessing ?? false,
      currentTool: initialState.currentTool,
    };

    // Only enable if terminal supports it
    this.enabled = process.stdout.isTTY && !process.env.CI;
  }

  /**
   * Update state and re-render
   */
  update(partial: Partial<StatusBarState>): void {
    Object.assign(this.state, partial);
    this.render();
  }

  /**
   * Add tokens to the count
   */
  addTokens(count: number): void {
    this.state.tokens += count;
    this.render();
  }

  /**
   * Build the status line content
   */
  private buildLine(width: number): string {
    // Refresh git info every 5 seconds
    const now = Date.now();
    if (now - this.gitCheckTime > 5000) {
      this.gitInfo = getGitInfo();
      this.gitCheckTime = now;
    }

    // Left side: karl + git + context
    const parts: string[] = [];

    // Karl label
    parts.push(pc.bold(pc.cyan('karl')));

    // Git branch
    if (this.gitInfo) {
      const branchDisplay = this.gitInfo.branch + (this.gitInfo.dirty ? '*' : '');
      parts.push(pc.yellow(branchDisplay));
    }

    // Context percentage (if available)
    if (this.state.contextPercent !== undefined) {
      const pct = Math.round(this.state.contextPercent);
      const pctColor = pct > 80 ? pc.red : pct > 50 ? pc.yellow : pc.green;
      parts.push(pctColor(`${pct}%`));
    }

    // Processing indicator
    if (this.state.isProcessing) {
      if (this.state.currentTool) {
        parts.push(pc.cyan(`> ${this.state.currentTool}`));
      } else {
        parts.push(pc.cyan('>'));
      }
    } else {
      parts.push(pc.dim('>'));
    }

    // Model name
    parts.push(pc.white(formatModelName(this.state.model)));

    const left = '  ' + parts.join(' ');

    // Right side: token count
    const tokenStr = `${formatTokens(this.state.tokens)} tokens`;
    const right = pc.dim(tokenStr) + '  ';

    // Calculate padding
    // Strip ANSI codes for length calculation
    const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
    const leftLen = stripAnsi(left).length;
    const rightLen = stripAnsi(right).length;
    const padding = Math.max(0, width - leftLen - rightLen);

    // Build the separator and content
    const separator = pc.dim('─'.repeat(width));
    const content = left + ' '.repeat(padding) + right;

    // Two lines: separator + content
    // We move up one extra line to write both
    return '\x1b[2K' + separator + '\n\x1b[2K' + content;
  }

  /**
   * Render the status bar (two lines: separator + content)
   */
  render(): void {
    if (!this.enabled || this.hidden) return;

    const width = process.stdout.columns || 80;
    const line = this.buildLine(width);

    // Only update if changed
    if (line === this.lastRender) return;
    this.lastRender = line;

    // Save cursor, move to second-to-last row, write two lines, restore cursor
    const rows = process.stdout.rows || 24;
    process.stdout.write(`\x1b7\x1b[${rows - 1};1H${line}\x1b8`);
  }

  /**
   * Clear the status bar (call before exiting)
   */
  clear(): void {
    if (!this.enabled) return;

    const rows = process.stdout.rows || 24;
    // Clear both lines of the status bar
    process.stdout.write(`\x1b7\x1b[${rows - 1};1H\x1b[2K\x1b[${rows};1H\x1b[2K\x1b8`);
  }

  /**
   * Temporarily hide the status bar (stops refresh interval)
   */
  hide(): void {
    if (!this.enabled || this.hidden) return;
    this.hidden = true;
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    this.clear();
  }

  /**
   * Show the status bar after hiding (restarts refresh interval)
   */
  show(): void {
    if (!this.enabled || !this.hidden) return;
    this.hidden = false;
    this.lastRender = '';  // Force re-render
    this.render();
    // Restart refresh interval
    this.refreshInterval = setInterval(() => {
      this.lastRender = '';
      this.render();
    }, 500);
  }

  /**
   * Start the status bar with periodic refresh
   */
  reserve(): void {
    if (!this.enabled) return;

    // Initial render
    this.render();

    // Refresh every 500ms to keep the bar visible after output
    this.refreshInterval = setInterval(() => {
      this.lastRender = '';  // Force re-render
      this.render();
    }, 500);
  }

  /**
   * Stop and clean up the status bar
   */
  release(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    this.clear();
  }
}
