/**
 * CLI commands for managing Config Stacks
 */

import { StackManager } from '../stacks.js';
import { loadConfig } from '../config.js';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { StackConfig } from '../types.js';

/**
 * Parse duration string (e.g., "10s", "5m", "1h") to milliseconds
 */
function parseDuration(input: string): number {
  const match = input.match(/^(\d+)(ms|s|m|h)?$/);
  if (!match) {
    console.error(`Invalid duration: "${input}". Use format like "10s", "5m", "1h", or "30000" (ms)`);
    process.exit(1);
  }

  const value = parseInt(match[1], 10);
  const unit = match[2] || 'ms';

  switch (unit) {
    case 'ms': return value;
    case 's': return value * 1000;
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    default: return value;
  }
}

/**
 * Format milliseconds as human-readable duration
 */
function formatDuration(ms: number): string {
  if (ms >= 60 * 60 * 1000) {
    return `${ms / (60 * 60 * 1000)}h`;
  } else if (ms >= 60 * 1000) {
    return `${ms / (60 * 1000)}m`;
  } else if (ms >= 1000) {
    return `${ms / 1000}s`;
  }
  return `${ms}ms`;
}

function readJsonFile(filePath: string): Record<string, unknown> {
  const content = readFileSync(filePath, 'utf-8');
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Invalid JSON at ${filePath}: ${(error as Error).message}`);
  }
}

function writeJsonFile(filePath: string, data: Record<string, unknown>): void {
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

function getProjectConfigPath(): string {
  return join(process.cwd(), '.karl.json');
}

function normalizeClearField(field: string): keyof StackConfig | null {
  const map: Record<string, keyof StackConfig> = {
    model: 'model',
    skill: 'skill',
    extends: 'extends',
    timeout: 'timeout',
    temperature: 'temperature',
    'max-tokens': 'maxTokens',
    maxTokens: 'maxTokens',
    context: 'context',
    'context-file': 'contextFile',
    contextFile: 'contextFile',
    tools: 'tools',
    unrestricted: 'unrestricted',
  };
  return map[field] ?? null;
}

type StackLocation =
  | { kind: 'project-file'; path: string }
  | { kind: 'global-file'; path: string }
  | { kind: 'inline-project'; path: string }
  | { kind: 'inline-global'; path: string };

function resolveStackLocation(name: string): StackLocation | null {
  const projectPath = join(process.cwd(), '.karl', 'stacks', `${name}.json`);
  if (existsSync(projectPath)) {
    return { kind: 'project-file', path: projectPath };
  }

  const globalPath = join(homedir(), '.config', 'karl', 'stacks', `${name}.json`);
  if (existsSync(globalPath)) {
    return { kind: 'global-file', path: globalPath };
  }

  const projectConfigPath = getProjectConfigPath();
  if (existsSync(projectConfigPath)) {
    const projectConfig = readJsonFile(projectConfigPath);
    const stacks = projectConfig.stacks as Record<string, unknown> | undefined;
    if (stacks && Object.prototype.hasOwnProperty.call(stacks, name)) {
      return { kind: 'inline-project', path: projectConfigPath };
    }
  }

  const globalConfigPath = join(homedir(), '.config', 'karl', 'karl.json');
  if (existsSync(globalConfigPath)) {
    const globalConfig = readJsonFile(globalConfigPath);
    const stacks = globalConfig.stacks as Record<string, unknown> | undefined;
    if (stacks && Object.prototype.hasOwnProperty.call(stacks, name)) {
      return { kind: 'inline-global', path: globalConfigPath };
    }
  }

  return null;
}

function applyStackUpdate(
  stack: Record<string, unknown>,
  changes: Partial<StackConfig>,
  clearFields: Set<keyof StackConfig>
): Record<string, unknown> {
  const next = { ...stack, ...changes };
  for (const field of clearFields) {
    delete next[field];
  }
  return next;
}

export interface StacksListOptions {
  verbose?: boolean;
  namesOnly?: boolean;  // For shell completion
}

/**
 * List all available stacks
 */
export async function listStacks(options: StacksListOptions = {}) {
  const cwd = process.cwd();
  const config = await loadConfig(cwd);
  const manager = new StackManager(config);
  const stacks = await manager.listStacks();

  // Names-only mode for shell completion
  if (options.namesOnly) {
    for (const stack of stacks) {
      console.log(stack.name);
    }
    return;
  }

  if (stacks.length === 0) {
    console.log('No stacks found.');
    console.log('');
    console.log('Create stacks in:');
    console.log('  ~/.config/karl/stacks/<name>.json');
    console.log('  ./.karl/stacks/<name>.json');
    console.log('  Or inline in karl.json: { "stacks": { "<name>": { ... } } }');
    return;
  }

  console.log(`Found ${stacks.length} stack${stacks.length === 1 ? '' : 's'}:\n`);

  for (const stack of stacks) {
    if (options.verbose) {
      console.log(`◍ ${stack.name}`);
      if (stack.model) console.log(`  Model: ${stack.model}`);
      if (stack.skill) console.log(`  Skill: ${stack.skill}`);
      if (stack.extends) console.log(`  Extends: ${stack.extends}`);
      console.log(`  Location: ${stack.path}\n`);
    } else {
      const parts = [stack.name.padEnd(20)];
      if (stack.model) parts.push(`model:${stack.model}`);
      if (stack.skill) parts.push(`skill:${stack.skill}`);
      if (stack.extends) parts.push(`extends:${stack.extends}`);
      console.log(`◍ ${parts.join(' ')}`);
    }
  }
}

/**
 * Show detailed information about a specific stack
 */
export async function showStack(name: string) {
  const cwd = process.cwd();
  const config = await loadConfig(cwd);
  const manager = new StackManager(config);
  const stack = await manager.getStack(name);

  if (!stack) {
    console.error(`Stack "${name}" not found.`);
    process.exit(1);
  }

  console.log(`# ${stack.name}\n`);

  if (stack.extends) {
    console.log(`**Extends:** ${stack.extends}`);
  }

  if (stack.model) {
    console.log(`**Model:** ${stack.model}`);
  }

  if (stack.temperature !== undefined) {
    console.log(`**Temperature:** ${stack.temperature}`);
  }

  if (stack.timeout !== undefined) {
    console.log(`**Timeout:** ${formatDuration(stack.timeout)}`);
  }

  if (stack.maxTokens !== undefined) {
    console.log(`**Max Tokens:** ${stack.maxTokens}`);
  }

  if (stack.skill) {
    console.log(`**Skill:** ${stack.skill}`);
  }

  if (stack.context) {
    console.log(`\n**Context:**\n${stack.context}`);
  }

  if (stack.contextFile) {
    console.log(`**Context File:** ${stack.contextFile}`);
  }

  if (stack.unrestricted) {
    console.log(`**Unrestricted:** true`);
  }

  console.log(`\n**Usage:**`);
  console.log(`  karl ${name} "your task"`);
}

export interface CreateStackOptions {
  model?: string;
  skill?: string;
  extends?: string;
  global?: boolean;
  timeout?: number;
  context?: string;
}

/**
 * Create a new stack
 */
export async function createStack(name: string, options: CreateStackOptions = {}) {
  // Determine path
  let stacksDir: string;
  if (options.global) {
    stacksDir = join(homedir(), '.config', 'karl', 'stacks');
  } else {
    stacksDir = join(process.cwd(), '.karl', 'stacks');
  }

  // Create directory if needed
  if (!existsSync(stacksDir)) {
    mkdirSync(stacksDir, { recursive: true });
  }

  const stackPath = join(stacksDir, `${name}.json`);

  if (existsSync(stackPath)) {
    console.error(`Stack "${name}" already exists at ${stackPath}`);
    process.exit(1);
  }

  // Build stack config
  const stack: Record<string, unknown> = {};

  if (options.extends) {
    stack.extends = options.extends;
  }

  if (options.model) {
    stack.model = options.model;
  }

  if (options.skill) {
    stack.skill = options.skill;
  }

  if (options.timeout) {
    stack.timeout = options.timeout;
  }

  if (options.context) {
    stack.context = options.context;
  }

  writeFileSync(stackPath, JSON.stringify(stack, null, 2) + '\n');

  console.log(`✓ Stack "${name}" created at ${stackPath}`);
  console.log(`\nUsage:`);
  console.log(`  karl ${name} "your task"`);
  console.log(`\nEdit the stack:`);
  console.log(`  ${stackPath}`);
}

/**
 * Remove a stack
 */
export async function removeStack(name: string) {
  const globalPath = join(homedir(), '.config', 'karl', 'stacks', `${name}.json`);
  const projectPath = join(process.cwd(), '.karl', 'stacks', `${name}.json`);

  let removed = false;

  if (existsSync(projectPath)) {
    const { unlinkSync } = await import('fs');
    unlinkSync(projectPath);
    console.log(`✓ Removed project stack: ${projectPath}`);
    removed = true;
  }

  if (existsSync(globalPath)) {
    const { unlinkSync } = await import('fs');
    unlinkSync(globalPath);
    console.log(`✓ Removed global stack: ${globalPath}`);
    removed = true;
  }

  if (!removed) {
    console.error(`Stack "${name}" not found.`);
    process.exit(1);
  }
}

/**
 * Edit a stack in $EDITOR (or print the path)
 */
export async function editStack(name: string) {
  const globalPath = join(homedir(), '.config', 'karl', 'stacks', `${name}.json`);
  const projectPath = join(process.cwd(), '.karl', 'stacks', `${name}.json`);

  let stackPath: string | null = null;

  if (existsSync(projectPath)) {
    stackPath = projectPath;
  } else if (existsSync(globalPath)) {
    stackPath = globalPath;
  }

  if (!stackPath) {
    console.error(`Stack "${name}" not found.`);
    process.exit(1);
  }

  // Try to open in editor
  const editor = process.env.EDITOR || process.env.VISUAL;
  if (editor) {
    const { spawnSync } = await import('child_process');
    spawnSync(editor, [stackPath], { stdio: 'inherit' });
  } else {
    console.log(`Stack location: ${stackPath}`);
    console.log('');
    console.log('Set $EDITOR to open automatically, or edit the file directly.');
  }
}

export interface UpdateStackOptions {
  changes: Partial<StackConfig>;
  clearFields?: Set<keyof StackConfig>;
}

/**
 * Update a stack in place (file or inline config).
 */
export async function updateStack(name: string, options: UpdateStackOptions) {
  try {
    const location = resolveStackLocation(name);
    if (!location) {
      console.error(`Stack "${name}" not found.`);
      process.exit(1);
    }

    const clearFields = options.clearFields ?? new Set<keyof StackConfig>();
    const changes = options.changes;

    if (location.kind === 'project-file' || location.kind === 'global-file') {
      const stack = readJsonFile(location.path);
      if (!stack || typeof stack !== 'object' || Array.isArray(stack)) {
        console.error(`Invalid stack file: ${location.path}`);
        process.exit(1);
      }
      const updated = applyStackUpdate(stack, changes, clearFields);
      writeJsonFile(location.path, updated);
      console.log(`✓ Stack "${name}" updated at ${location.path}`);
      return;
    }

    const config = readJsonFile(location.path);
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      console.error(`Invalid config file: ${location.path}`);
      process.exit(1);
    }
    const stacks = (config.stacks ?? {}) as Record<string, unknown>;
    const stack = (stacks[name] ?? {}) as Record<string, unknown>;
    const updated = applyStackUpdate(stack, changes, clearFields);
    stacks[name] = updated;
    config.stacks = stacks;
    writeJsonFile(location.path, config);
    console.log(`✓ Stack "${name}" updated in ${location.path}`);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Handle stacks subcommands
 */
export async function handleStacksCommand(args: string[]) {
  const [command, ...rest] = args;

  switch (command) {
    case 'list':
    case 'ls':
      const verbose = rest.includes('--verbose') || rest.includes('-v');
      const namesOnly = rest.includes('--names');
      await listStacks({ verbose, namesOnly });
      break;

    case 'show':
    case 'info':
      if (rest.length === 0) {
        console.error('Usage: karl stacks show <stack-name>');
        process.exit(1);
      }
      await showStack(rest[0]);
      break;

    case 'create':
    case 'new': {
      if (rest.length === 0) {
        console.error('Usage: karl stacks create <name> [--model <model>] [--skill <skill>] [--timeout <duration>] [--global]');
        process.exit(1);
      }

      const name = rest[0];
      const createOptions: CreateStackOptions = {};

      // Parse flags
      for (let i = 1; i < rest.length; i++) {
        if ((rest[i] === '--model' || rest[i] === '-m') && rest[i + 1]) {
          createOptions.model = rest[++i];
        } else if ((rest[i] === '--skill' || rest[i] === '-s') && rest[i + 1]) {
          createOptions.skill = rest[++i];
        } else if (rest[i] === '--extends' && rest[i + 1]) {
          createOptions.extends = rest[++i];
        } else if ((rest[i] === '--timeout' || rest[i] === '-t') && rest[i + 1]) {
          createOptions.timeout = parseDuration(rest[++i]);
        } else if ((rest[i] === '--context' || rest[i] === '-c') && rest[i + 1]) {
          createOptions.context = rest[++i];
        } else if (rest[i] === '--global' || rest[i] === '-g') {
          createOptions.global = true;
        }
      }

      await createStack(name, createOptions);
      break;
    }

    case 'set':
    case 'update': {
      if (rest.length === 0) {
        console.error('Usage: karl stacks set <stack-name> [options]');
        process.exit(1);
      }

      const name = rest[0];
      const changes: Partial<StackConfig> = {};
      const clearFields = new Set<keyof StackConfig>();
      const tools: string[] = [];

      for (let i = 1; i < rest.length; i++) {
        const arg = rest[i];
        if ((arg === '--model' || arg === '-m') && rest[i + 1]) {
          changes.model = rest[++i];
        } else if ((arg === '--skill' || arg === '-s') && rest[i + 1]) {
          changes.skill = rest[++i];
        } else if (arg === '--extends' && rest[i + 1]) {
          changes.extends = rest[++i];
        } else if ((arg === '--timeout' || arg === '-t') && rest[i + 1]) {
          changes.timeout = parseDuration(rest[++i]);
        } else if (arg === '--temperature' && rest[i + 1]) {
          changes.temperature = parseFloat(rest[++i]);
        } else if (arg === '--max-tokens' && rest[i + 1]) {
          changes.maxTokens = parseInt(rest[++i], 10);
        } else if ((arg === '--context' || arg === '-c') && rest[i + 1]) {
          changes.context = rest[++i];
        } else if (arg === '--context-file' && rest[i + 1]) {
          changes.contextFile = rest[++i];
        } else if (arg === '--tools' && rest[i + 1]) {
          const value = rest[++i];
          if (value === 'none') {
            changes.tools = [];
          } else {
            const parts = value.split(',').map(p => p.trim()).filter(Boolean);
            tools.push(...parts);
            changes.tools = Array.from(new Set(tools));
          }
        } else if (arg === '--unrestricted') {
          changes.unrestricted = true;
        } else if (arg === '--restricted') {
          changes.unrestricted = false;
        } else if (arg === '--clear' && rest[i + 1]) {
          const field = normalizeClearField(rest[++i]);
          if (!field) {
            console.error(`Unknown field to clear: ${rest[i]}`);
            process.exit(1);
          }
          clearFields.add(field);
        }
      }

      await updateStack(name, { changes, clearFields });
      break;
    }

    case 'remove':
    case 'rm':
    case 'delete':
      if (rest.length === 0) {
        console.error('Usage: karl stacks remove <stack-name>');
        process.exit(1);
      }
      const stackToRemove = rest[0];
      if (stackToRemove === 'default') {
        console.error('Cannot delete the "default" stack.');
        console.error('You can modify it with: karl stacks edit default');
        process.exit(1);
      }
      await removeStack(stackToRemove);
      break;

    case 'edit':
      if (rest.length === 0) {
        console.error('Usage: karl stacks edit <stack-name>');
        process.exit(1);
      }
      await editStack(rest[0]);
      break;

    default:
      if (!command) {
        console.error('Usage: karl stacks <command>');
        console.error('');
        console.error('Commands:');
        console.error('  list              List available stacks');
        console.error('  show <name>       Show stack details');
        console.error('  create <name>     Create a new stack');
        console.error('  edit <name>       Edit a stack in $EDITOR');
        console.error('  set <name>        Update stack fields');
        console.error('  remove <name>     Remove a stack');
      } else {
        console.error(`Unknown stacks command: ${command}`);
        console.error('Available commands: list, show, create, edit, set, remove');
      }
      process.exit(1);
  }
}
