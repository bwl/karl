import { TaskState, VolleyState } from './types.js';

export interface TuiRenderer {
  update(state: VolleyState): void;
  close(): void;
}

interface PiTuiModule {
  Screen: new (options: { altBuffer: boolean }) => { exit: () => void };
  Box: (props: { border?: string }, children?: any[]) => any;
  Text: (content: string) => any;
  render: (screen: any, node: any) => void;
}

class NoopTuiRenderer implements TuiRenderer {
  update(): void {
    return;
  }

  close(): void {
    return;
  }
}

class AnsiTuiRenderer implements TuiRenderer {
  private lastFrame = '';

  constructor() {
    process.stdout.write('\x1b[?1049h');
    process.stdout.write('\x1b[H');
  }

  update(state: VolleyState): void {
    const frame = renderFrame(state);
    if (frame === this.lastFrame) {
      return;
    }
    this.lastFrame = frame;
    process.stdout.write('\x1b[2J');
    process.stdout.write('\x1b[H');
    process.stdout.write(frame);
  }

  close(): void {
    process.stdout.write('\x1b[2J');
    process.stdout.write('\x1b[H');
    process.stdout.write('\x1b[?1049l');
  }
}

class PiTuiRenderer implements TuiRenderer {
  private screen: any;

  constructor(private pi: PiTuiModule) {
    this.screen = new this.pi.Screen({ altBuffer: true });
  }

  update(state: VolleyState): void {
    const tree = renderPiTree(state, this.pi);
    this.pi.render(this.screen, tree);
  }

  close(): void {
    this.screen.exit();
  }
}

function statusIcon(status: TaskState['status']): string {
  switch (status) {
    case 'queued':
      return 'o';
    case 'running':
      return '>';
    case 'done':
      return '*';
    case 'error':
      return 'x';
    default:
      return '?';
  }
}

function renderFrame(state: VolleyState): string {
  const width = process.stdout.columns ?? 80;
  const lines: string[] = [];
  const total = state.tasks.length;
  const completed = state.tasks.filter((task) => task.status === 'done' || task.status === 'error').length;

  const header = total > 1 ? `karl volley (${completed}/${total})` : 'karl';
  lines.push(header);
  lines.push('-'.repeat(Math.min(width, 60)));

  for (const task of state.tasks) {
    const prompt = task.prompt.replace(/\s+/g, ' ').trim();
    const label = `${task.index + 1}. [${statusIcon(task.status)}] ${prompt}`;
    lines.push(truncate(label, width));

    const toolLines = formatTools(task, width);
    lines.push(...toolLines);
  }

  lines.push('-'.repeat(Math.min(width, 60)));
  const elapsed = Date.now() - state.startTime;
  lines.push(`elapsed: ${formatDuration(elapsed)}  tasks: ${completed}/${total}`);

  return lines.join('\n') + '\n';
}

function formatTools(task: TaskState, width: number): string[] {
  if (task.tools.length === 0) {
    return [];
  }
  const lines: string[] = [];
  for (const tool of task.tools) {
    const label = `   - ${statusIcon(tool.status)} ${tool.name}`;
    lines.push(truncate(label, width));
  }
  return lines;
}

function truncate(value: string, width: number): string {
  if (value.length <= width) {
    return value;
  }
  return value.slice(0, Math.max(0, width - 3)) + '...';
}

function formatDuration(ms: number): string {
  if (ms < 1_000) {
    return `${ms}ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1_000).toFixed(1)}s`;
  }
  return `${(ms / 60_000).toFixed(1)}m`;
}

function isPiTuiCompatible(module: any): module is PiTuiModule {
  return Boolean(module?.Screen && module?.Box && module?.Text && module?.render);
}

function renderPiTree(state: VolleyState, pi: PiTuiModule) {
  const lines: string[] = [];
  const total = state.tasks.length;
  const completed = state.tasks.filter((task) => task.status === 'done' || task.status === 'error').length;
  const header = total > 1 ? `karl volley (${completed}/${total})` : 'karl';

  lines.push(header);
  lines.push('------------------------------------------------------------');
  for (const task of state.tasks) {
    const prompt = task.prompt.replace(/\s+/g, ' ').trim();
    lines.push(`${task.index + 1}. [${statusIcon(task.status)}] ${prompt}`);
    for (const tool of task.tools) {
      lines.push(`   - ${statusIcon(tool.status)} ${tool.name}`);
    }
  }
  lines.push('------------------------------------------------------------');
  lines.push(`elapsed: ${formatDuration(Date.now() - state.startTime)}  tasks: ${completed}/${total}`);

  return pi.Box({ border: 'none' }, lines.map((line) => pi.Text(line)));
}

export async function createTuiRenderer(enabled: boolean): Promise<TuiRenderer> {
  if (!enabled || !process.stdout.isTTY) {
    return new NoopTuiRenderer();
  }
  if (process.env.KARL_TUI !== 'ansi') {
    const imported = await import('@mariozechner/pi-tui').catch(() => null);
    const pi = imported && (imported.default ?? imported);
    if (pi && isPiTuiCompatible(pi)) {
      return new PiTuiRenderer(pi);
    }
  }
  return new AnsiTuiRenderer();
}
