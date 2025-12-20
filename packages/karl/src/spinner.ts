/**
 * Mini TUI progress display for CLI
 * Tennis-themed flipbook animation - slow, charming scenes
 */

// Flipbook scenes - each is a multi-line ASCII art frame
// Displayed slowly like a comic strip while working
// All frames must be exactly 5 lines to prevent jumping
const FRAME_HEIGHT = 5;
const EMPTY_LINE = '              ';

const FLIPBOOK: string[][] = [
  // Serve sequence
  [
    EMPTY_LINE,
    EMPTY_LINE,
    '    ○         ',
    '   /|\\   🎾   ',
    '   / \\        ',
  ],
  [
    EMPTY_LINE,
    EMPTY_LINE,
    '    ○    🎾   ',
    '   /|\\        ',
    '   / \\        ',
  ],
  [
    EMPTY_LINE,
    EMPTY_LINE,
    '    ○         ',
    '   \\|    🎾   ',
    '   / \\        ',
  ],
  [
    EMPTY_LINE,
    EMPTY_LINE,
    '    ○         ',
    '   \\|/   🎾   ',
    '   / \\        ',
  ],
  // Ball in flight
  [
    EMPTY_LINE,
    '         🎾   ',
    '    ○         ',
    '   /|\\        ',
    '   / \\        ',
  ],
  [
    EMPTY_LINE,
    EMPTY_LINE,
    '    ○    🎾   ',
    '   /|\\        ',
    '   / \\        ',
  ],
  // Return shot
  [
    EMPTY_LINE,
    EMPTY_LINE,
    '    ○         ',
    '   /|\\   🎾   ',
    '   / \\        ',
  ],
  [
    EMPTY_LINE,
    EMPTY_LINE,
    '    ○         ',
    '   \\|/        ',
    '   / \\   🎾   ',
  ],
  // Diving save!
  [
    EMPTY_LINE,
    EMPTY_LINE,
    EMPTY_LINE,
    '    ○_/       ',
    '   /|    🎾   ',
  ],
  [
    EMPTY_LINE,
    EMPTY_LINE,
    EMPTY_LINE,
    '   \\○_🎾      ',
    '    |\\        ',
  ],
  // Got it!
  [
    '        🎾    ',
    EMPTY_LINE,
    '   \\○/        ',
    '    |         ',
    '   / \\        ',
  ],
  // Victory pose
  [
    EMPTY_LINE,
    EMPTY_LINE,
    '   \\○/   🎾   ',
    '    |         ',
    '   / \\        ',
  ],
  [
    EMPTY_LINE,
    '     🎾       ',
    '   \\○/        ',
    '    |         ',
    '   / \\        ',
  ],
  // Ball bouncing away
  [
    EMPTY_LINE,
    EMPTY_LINE,
    '    ○     🎾  ',
    '   /|\\        ',
    '   / \\        ',
  ],
  [
    EMPTY_LINE,
    EMPTY_LINE,
    '    ○         ',
    '   /|\\    🎾  ',
    '   / \\        ',
  ],
  // Waiting for next point
  [
    EMPTY_LINE,
    EMPTY_LINE,
    '    ○         ',
    '   /|\\        ',
    '   / \\    🎾  ',
  ],
  [
    EMPTY_LINE,
    EMPTY_LINE,
    '    ○    🎾   ',
    '   /|\\        ',
    '   / \\        ',
  ],
  // Getting ready again
  [
    EMPTY_LINE,
    EMPTY_LINE,
    '    ○   🎾    ',
    '   /|\\        ',
    '   / \\        ',
  ],
];

const SPINNER_FRAMES = ['◐', '◓', '◑', '◒'];

function getTerminalWidth(): number {
  return process.stderr.columns || 80;
}

interface ToolCall {
  name: string;
  detail: string;
  status: 'running' | 'done' | 'error';
}

export class Spinner {
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

  constructor(enabled = true, verbose = false) {
    this.verbose = verbose;
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
        // Incremental update - just print the new part
        const newText = text.slice(this.lastThinkingText.length);
        process.stderr.write(`\x1b[2m${newText}\x1b[0m`);
      } else if (text !== this.lastThinkingText) {
        // Text changed completely, print it all
        process.stderr.write(`\x1b[2m${text}\x1b[0m`);
      }
      this.lastThinkingText = text;
      return;
    }

    // Take last few lines of thinking, clean and truncate to terminal width
    const maxWidth = getTerminalWidth() - 4;  // Leave room for prefix
    const lines = text.split('\n').filter(l => l.trim());
    this.thinking = lines.slice(-4).map(l => truncate(l.trim(), maxWidth));
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
    if (this.lines > 0) {
      // Move up and clear each line
      process.stderr.write(`\x1b[${this.lines}A`);
      for (let i = 0; i < this.lines; i++) {
        process.stderr.write('\x1b[2K\n');
      }
      process.stderr.write(`\x1b[${this.lines}A`);
    }
  }

  private render(): void {
    this.clearLines();
    
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    const scene = FLIPBOOK[this.frameIndex % FLIPBOOK.length];
    const spinner = SPINNER_FRAMES[this.frameIndex % SPINNER_FRAMES.length];
    
    const lines: string[] = [];
    
    // Flipbook scene - no border, just the art
    for (const sceneLine of scene) {
      lines.push(`\x1b[2m${sceneLine}\x1b[0m`);
    }
    
    // Thinking section (if any)
    if (this.thinking.length > 0) {
      lines.push('');
      lines.push(`\x1b[2m∴ Thinking…\x1b[0m`);
      for (const line of this.thinking) {
        lines.push(`\x1b[2m  ${line}\x1b[0m`);
      }
    }
    
    // Current status
    const status = this.message || 'karl is on it...';
    lines.push('');
    lines.push(`  ${spinner} ${status} \x1b[2m(${elapsed}s)\x1b[0m`);
    
    // Tool traces (last 3)
    if (this.toolCalls.length > 0) {
      lines.push('');
      for (const tool of this.toolCalls) {
        const icon = tool.status === 'running' ? '▸' : 
                     tool.status === 'done' ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
        const detail = tool.detail ? ` \x1b[2m${truncate(tool.detail, 40)}\x1b[0m` : '';
        lines.push(`  ${icon} ${tool.name}${detail}`);
      }
    }
    
    const output = lines.join('\n') + '\n';
    this.lines = lines.length;
    process.stderr.write(output);
  }

  stop(finalMessage?: string): void {
    if (!this.enabled) return;

    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    if (this.verbose) {
      // In verbose mode, just add a newline and optional message
      const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
      process.stderr.write(`\n\x1b[2m── done in ${elapsed}s ──\x1b[0m\n\n`);
      return;
    }

    // Clear our display
    this.clearLines();
    this.lines = 0;

    if (finalMessage) {
      process.stderr.write(`${finalMessage}\n`);
    }
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + '...';
}

/**
 * Format tool name for display
 */
export function formatToolTrace(tool: string, status: 'start' | 'end', success?: boolean): string {
  const icon = status === 'start' ? '▸' : (success ? '✓' : '✗');
  return `${icon} ${tool}`;
}
