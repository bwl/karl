/**
 * CLI commands for managing Config Stacks
 */

import { StackManager } from '../stacks.js';
import { loadConfig } from '../config.js';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface StacksListOptions {
  verbose?: boolean;
}

/**
 * List all available stacks
 */
export async function listStacks(options: StacksListOptions = {}) {
  const cwd = process.cwd();
  const config = await loadConfig(cwd);
  const manager = new StackManager(config);
  const stacks = await manager.listStacks();

  if (stacks.length === 0) {
    console.log('No stacks found.');
    console.log('');
    console.log('Create stacks in:');
    console.log('  ~/.config/cliffy/stacks/<name>.json');
    console.log('  ./.cliffy/stacks/<name>.json');
    console.log('  Or inline in cliffy.json: { "stacks": { "<name>": { ... } } }');
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
    console.log(`**Timeout:** ${stack.timeout}ms`);
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
  console.log(`  cliffy as ${name} "your task"`);
}

/**
 * Create a new stack
 */
export async function createStack(name: string, options: { model?: string; skill?: string; extends?: string; global?: boolean } = {}) {
  // Determine path
  let stacksDir: string;
  if (options.global) {
    stacksDir = join(homedir(), '.config', 'cliffy', 'stacks');
  } else {
    stacksDir = join(process.cwd(), '.cliffy', 'stacks');
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

  // Add some defaults for empty stacks
  if (Object.keys(stack).length === 0) {
    stack.model = 'smart';
  }

  writeFileSync(stackPath, JSON.stringify(stack, null, 2) + '\n');

  console.log(`✓ Stack "${name}" created at ${stackPath}`);
  console.log(`\nUsage:`);
  console.log(`  cliffy as ${name} "your task"`);
  console.log(`\nEdit the stack:`);
  console.log(`  ${stackPath}`);
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
      await listStacks({ verbose });
      break;

    case 'show':
    case 'info':
      if (rest.length === 0) {
        console.error('Usage: cliffy stacks show <stack-name>');
        process.exit(1);
      }
      await showStack(rest[0]);
      break;

    case 'create':
    case 'new':
      if (rest.length === 0) {
        console.error('Usage: cliffy stacks create <stack-name> [--model <model>] [--skill <skill>] [--extends <parent>] [--global]');
        process.exit(1);
      }

      const name = rest[0];
      const createOptions: { model?: string; skill?: string; extends?: string; global?: boolean } = {};

      // Parse flags
      for (let i = 1; i < rest.length; i++) {
        if (rest[i] === '--model' && rest[i + 1]) {
          createOptions.model = rest[++i];
        } else if (rest[i] === '--skill' && rest[i + 1]) {
          createOptions.skill = rest[++i];
        } else if (rest[i] === '--extends' && rest[i + 1]) {
          createOptions.extends = rest[++i];
        } else if (rest[i] === '--global' || rest[i] === '-g') {
          createOptions.global = true;
        }
      }

      await createStack(name, createOptions);
      break;

    default:
      if (!command) {
        console.error('Usage: cliffy stacks <command>');
        console.error('');
        console.error('Commands:');
        console.error('  list              List available stacks');
        console.error('  show <name>       Show stack details');
        console.error('  create <name>     Create a new stack');
      } else {
        console.error(`Unknown stacks command: ${command}`);
        console.error('Available commands: list, show, create');
      }
      process.exit(1);
  }
}
