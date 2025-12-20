import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

export function resolveHomePath(inputPath: string): string {
  if (inputPath === '~') {
    return os.homedir();
  }
  if (inputPath.startsWith('~/')) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readTextFile(filePath: string): Promise<string> {
  return await fs.readFile(filePath, 'utf8');
}

export async function readTextIfExists(filePath: string): Promise<string | null> {
  if (!(await pathExists(filePath))) {
    return null;
  }
  return await readTextFile(filePath);
}

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export function expandEnv(value: string): string {
  return value.replace(/\$\{([^}:]+)(?::-([^}]+))?\}/g, (_, name: string, fallback: string) => {
    const resolved = process.env[name];
    if (resolved === undefined || resolved === '') {
      return fallback ?? '';
    }
    return resolved;
  });
}

export function deepMerge<T>(base: T, override?: Partial<T>): T {
  if (override === undefined || override === null) {
    return base;
  }
  if (Array.isArray(base) || Array.isArray(override)) {
    return (override as T) ?? base;
  }
  if (typeof base === 'object' && typeof override === 'object') {
    const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const [key, value] of Object.entries(override)) {
      const baseValue = (base as Record<string, unknown>)[key];
      if (value === undefined) {
        continue;
      }
      if (typeof baseValue === 'object' && baseValue !== null && typeof value === 'object' && value !== null && !Array.isArray(value)) {
        result[key] = deepMerge(baseValue, value as Record<string, unknown>);
      } else {
        result[key] = value as unknown;
      }
    }
    return result as T;
  }
  return override as T;
}

export function parseDurationMs(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }
  const match = trimmed.match(/^([0-9]+(?:\.[0-9]+)?)(ms|s|m)?$/);
  if (!match) {
    return null;
  }
  const value = Number(match[1]);
  const unit = match[2] ?? 's';
  if (Number.isNaN(value)) {
    return null;
  }
  if (unit === 'ms') {
    return Math.round(value);
  }
  if (unit === 'm') {
    return Math.round(value * 60_000);
  }
  return Math.round(value * 1_000);
}

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatDuration(ms: number): string {
  if (ms < 1_000) {
    return `${ms}ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1_000).toFixed(1)}s`;
  }
  return `${(ms / 60_000).toFixed(1)}m`;
}
