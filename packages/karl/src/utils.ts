export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.floor(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = s / 60;
  if (m < 60) return `${m.toFixed(1)}m`;
  const h = m / 60;
  return `${h.toFixed(1)}h`;
}

export function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function parseDurationMs(dur: string): number {
  const timeUnits = { ms: 1, s: 1000, m: 60000, h: 3600000 };
  const match = dur.match(/^([0-9.]+)(ms|s|m|h)?$/i);
  if (!match) throw new Error(`Invalid duration: ${dur}`);
  const value = parseFloat(match[1]);
  const unit = match[2]?.toLowerCase() || 's';
  return value * (timeUnits[unit as keyof typeof timeUnits] ?? 1000);
}

export async function readTextIfExists(path: string): Promise<string | null> {
  try {
    return await Bun.file(path).text();
  } catch {
    return null;
  }
}

export function resolveHomePath(path: string): string {
  if (path.startsWith('~')) {
    return path.replace('~', process.env.HOME || '');
  }
  return path;
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function deepMerge<T extends Record<string, any>>(target: T, source: any): T {
  const result = target as Record<string, any>;
  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(result[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result as T;
}

export function expandEnv(str: string): string {
  return str.replace(/\${([^}]+)}/g, (match, name) => process.env[name] || match);
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await Bun.file(path).arrayBuffer();
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(dir: string): Promise<void> {
  const { mkdir } = await import('fs/promises');
  try {
    await mkdir(dir, { recursive: true });
  } catch {}
}
