/**
 * Mini TUI progress display for CLI
 * Tennis-themed flipbook animation - slow, charming scenes
 */

// Flipbook scenes - each is a multi-line ASCII art frame
// Displayed slowly like a comic strip while working
const FLIPBOOK: string[][] = [
  // Serve sequence
  [
    '    ○         ',
    '   /|\\   🎾   ',
    '   / \\        ',
  ],
  [
    '    ○    🎾   ',
    '   /|\\        ',
    '   / \\        ',
  ],
  [
    '    ○         ',
    '   \\|    🎾   ',
    '   / \\        ',
  ],
  [
    '    ○         ',
    '   \\|/   🎾   ',
    '   / \\        ',
  ],
  // Ball in flight
  [
    '         🎾   ',
    '    ○         ',
    '   /|\\        ',
    '   / \\        ',
  ],
  [
    '              ',
    '    ○    🎾   ',
    '   /|\\        ',
    '   / \\        ',
  ],
  // Return shot
  [
    '              ',
    '    ○         ',
    '   /|\\   🎾   ',
    '   / \\        ',
  ],
  [
    '              ',
    '    ○         ',
    '   \\|/        ',
    '   / \\   🎾   ',
  ],
  // Diving save!
  [
    '              ',
    '              ',
    '    ○_/       ',
    '   /|    🎾   ',
  ],
  [
    '              ',
    '              ',
    '   \\○_🎾      ',
    '    |\\        ',
  ],
  // Got it!
  [
    '        🎾    ',
    '              ',
    '   \\○/        ',
    '    |         ',
    '   / \\        ',
  ],
  // Victory pose
  [
    '              ',
    '   \\○/   🎾   ',
    '    |         ',
    '   / \\        ',
  ],
  [
    '     🎾       ',
    '   \\○/        ',
    '    |         ',
    '   / \\        ',
  ],
  // Ball bouncing away
  [
    '              ',
    '    ○     🎾  ',
    '   /|\\        ',
    '   / \\        ',
  ],
  [
    '              ',
    '    ○         ',
    '   /|\\    🎾  ',
    '   / \\        ',
  ],
  // Waiting for next point
  [
    '              ',
    '    ○         ',
    '   /|\\        ',
    '   / \\    🎾  ',
  ],
  [
    '              ',
    '    ○    🎾   ',
    '   /|\\        ',
    '   / \\        ',
  ],
  // Getting ready again
  [
    '    ○   🎾    ',
    '   /|\\        ',
    '   / \\        ',
  ],
];

const SPINNER_FRAMES = ['◐', '◓', '◑', '◒'];

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
  private startTime: number = 0;
  private toolCalls: ToolCall[] = [];
  private thinking: string[] = [];  // Lines of thinking text
  private lines = 0;

  constructor(enabled = true) {
    this.enabled = enabled && process.stderr.isTTY === true;
  }

  start(message: string): void {
    if (!this.enabled) return;
    
    this.message = message;
    this.frameIndex = 0;
    this.startTime = Date.now();
    this.toolCalls = [];
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
    // Take last few lines of thinking, clean and truncate
    const lines = text.split('\n').filter(l => l.trim());
    this.thinking = lines.slice(-4).map(l => truncate(l.trim(), 60));
    this.render();
  }

  toolStart(name: string, detail: string = ''): void {
    if (!this.enabled) return;
    this.toolCalls.push({ name, detail, status: 'running' });
    // Keep last 3 tool calls
    if (this.toolCalls.length > 3) {
      this.toolCalls.shift();
    }
    this.render();
  }

  toolEnd(name: string, success: boolean): void {
    if (!this.enabled) return;
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
    const status = this.message || 'cliffy is on it...';
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
