import path from 'path';
import { pathToFileURL } from 'url';
import { promises as fs } from 'fs';
import { HookModule, HookName, TaskHookEvent, ToolHookEvent, ErrorHookEvent } from './types.js';
import { pathExists, resolveHomePath } from './utils.js';

const HOOK_EXTENSIONS = new Set(['.js', '.ts', '.mjs', '.cjs']);

async function loadHooksFromDir(dirPath: string): Promise<HookModule[]> {
  if (!(await pathExists(dirPath))) {
    return [];
  }
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && HOOK_EXTENSIONS.has(path.extname(entry.name)))
    .map((entry) => entry.name)
    .sort();

  const modules: HookModule[] = [];
  for (const file of files) {
    const fullPath = path.join(dirPath, file);
    try {
      const mod = await import(pathToFileURL(fullPath).href);
      const hookModule = (mod.default ?? mod) as HookModule;
      if (hookModule && typeof hookModule === 'object') {
        modules.push(hookModule);
      }
    } catch (error) {
      console.error(`Failed to load hook: ${fullPath}: ${(error as Error).message}`);
    }
  }
  return modules;
}

export class HookRunner {
  constructor(private modules: HookModule[]) {}

  static async load(cwd: string): Promise<HookRunner> {
    const projectHooks = path.join(cwd, '.cliffy', 'hooks');
    const globalHooks = resolveHomePath('~/.config/cliffy/hooks');
    const modules = [
      ...(await loadHooksFromDir(projectHooks)),
      ...(await loadHooksFromDir(globalHooks))
    ];
    return new HookRunner(modules);
  }

  async run(hook: 'pre-task', event: TaskHookEvent): Promise<void>;
  async run(hook: 'post-task', event: TaskHookEvent & { result?: string; error?: string }): Promise<void>;
  async run(hook: 'pre-tool', event: ToolHookEvent): Promise<void>;
  async run(hook: 'post-tool', event: ToolHookEvent): Promise<void>;
  async run(hook: 'on-error', event: ErrorHookEvent): Promise<void>;
  async run(hook: HookName, event: TaskHookEvent | ToolHookEvent | ErrorHookEvent): Promise<void> {
    for (const module of this.modules) {
      const handler = module[hook];
      if (!handler) {
        continue;
      }
      try {
        await handler(event as never);
      } catch (error) {
        console.error(`Hook error (${hook}): ${(error as Error).message}`);
      }
    }
  }
}
