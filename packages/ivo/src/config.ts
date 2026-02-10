/**
 * Ivo Configuration — global + project config with deep merge
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { homedir } from 'os';

export interface IvoConfig {
  llm?: {
    endpoint?: string;
    model?: string;
    apiKey?: string;
  };
  defaults?: {
    budget?: number;
    intensity?: 'lite' | 'standard' | 'deep';
    format?: 'xml' | 'markdown' | 'json';
  };
}

export function getGlobalConfigPath(): string {
  return join(homedir(), '.config', 'ivo', 'config.json');
}

export function getProjectConfigPath(cwd?: string): string {
  return join(cwd ?? process.cwd(), '.ivo', 'config.json');
}

async function readJsonFile(path: string): Promise<IvoConfig> {
  try {
    const data = await readFile(path, 'utf-8');
    return JSON.parse(data) as IvoConfig;
  } catch {
    return {};
  }
}

function deepMerge(base: IvoConfig, override: IvoConfig): IvoConfig {
  const result: IvoConfig = { ...base };

  if (override.llm) {
    result.llm = { ...base.llm, ...override.llm };
  }
  if (override.defaults) {
    result.defaults = { ...base.defaults, ...override.defaults };
  }

  return result;
}

/**
 * Load config: deep-merge global + project (project wins).
 * Does NOT apply env vars — callers do that.
 */
export async function loadConfig(cwd?: string): Promise<IvoConfig> {
  const global = await readJsonFile(getGlobalConfigPath());
  const project = await readJsonFile(getProjectConfigPath(cwd));
  return deepMerge(global, project);
}

async function writeJsonFile(path: string, config: IvoConfig): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(config, null, 2) + '\n');
  return path;
}

/** Write global config, returns path */
export async function saveGlobalConfig(config: IvoConfig): Promise<string> {
  return writeJsonFile(getGlobalConfigPath(), config);
}

/** Write project config, returns path */
export async function saveProjectConfig(config: IvoConfig, cwd?: string): Promise<string> {
  return writeJsonFile(getProjectConfigPath(cwd), config);
}
