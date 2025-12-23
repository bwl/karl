import pc from 'picocolors';
import spinners from 'cli-spinners';

export function highlight(text: string): string {
  return text.split('\n').map((line) => {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('diff --git') || trimmed.startsWith('index ') || trimmed.startsWith('--- ') || trimmed.startsWith('+++ ')) {
      return pc.blue(line);
    }
    if (trimmed.startsWith('@@ ')) {
      return pc.yellow(line);
    }
    if (line.startsWith('+') && !trimmed.startsWith('+++')) {
      return pc.green(line);
    }
    if (line.startsWith('-') && !trimmed.startsWith('---')) {
      return pc.red(line);
    }
    return pc.dim(line);
  }).join('\n');
}

export type SpinnerStyle = 'unicode' | 'ascii' | 'none';

export interface VisualsMode {
  spinner: SpinnerStyle;
}

export const SPINNER_STYLES: Record<SpinnerStyle, readonly string[]> = {
  unicode: spinners.dots.frames,
  ascii: ['|', '/', '-', '\\\\'],
  none: ['']
};

export function detectVisuals(override: string = 'auto'): VisualsMode {
  if (override === 'none' || override === 'plain') {
    return { spinner: 'none' };
  }
  if (override === 'utf8') {
    return { spinner: 'unicode' };
  }
  if (override === 'ascii') {
    return { spinner: 'ascii' };
  }

  const term = (process.env.TERM || '').toLowerCase();
  const langUTF8 = (process.env.LANG || process.env.LC_ALL || '').toLowerCase().includes('utf-8');
  const utfTerms = ['xterm', 'screen', 'tmux', 'alacritty', 'iterm2', 'kitty', 'wezterm', 'vte', 'konsole', 'gnome'];
  const supportsUTF8 = langUTF8 && utfTerms.some(t => term.includes(t));

  if (!process.stdout.isTTY) {
    return { spinner: 'none' };
  }

  return { spinner: supportsUTF8 ? 'unicode' : 'ascii' };
}

export function getSpinnerFrame(elapsedMs: number, mode: VisualsMode): string {
  const frames = SPINNER_STYLES[mode.spinner];
  const index = Math.floor(elapsedMs / 120) % frames.length;
  return pc.cyan(frames[index]);
}
