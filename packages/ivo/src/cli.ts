#!/usr/bin/env bun
/**
 * Ivo CLI - Context Intelligence Engine for Karl
 *
 * Named after Ivo Karlović, the elite scout who knows where to aim.
 * Ivo prepares optimal context before Karl serves.
 */

import { Command } from 'commander';
import { registerCommands } from './commands/index.js';
import { getDefaultBackend, type IvoBackend } from './backends/types.js';

// Import and register backends
import './backends/native.js';
import './backends/repoprompt.js';

const VERSION = '0.1.0';

// Cached backend instance
let backendInstance: IvoBackend | undefined;

async function getBackend(): Promise<IvoBackend> {
  if (backendInstance) {
    return backendInstance;
  }

  const backend = await getDefaultBackend();
  if (!backend) {
    console.error('Error: No backend available.');
    console.error('');
    console.error('Ivo requires a backend to function. Currently supported:');
    console.error('  - RepoPrompt (requires RepoPrompt.app running with MCP enabled)');
    console.error('');
    console.error('To use RepoPrompt:');
    console.error('  1. Launch RepoPrompt.app');
    console.error('  2. Enable MCP Server in Settings > MCP');
    console.error('  3. Open a workspace/project');
    process.exit(1);
  }

  backendInstance = backend;
  return backend;
}

const program = new Command();

program
  .name('ivo')
  .description(
    `Ivo - Context Intelligence Engine for Karl

Ivo prepares optimal context before Karl executes tasks.
Like a tennis scout who analyzes the court, Ivo identifies
the most relevant files and builds efficient context.

Currently uses RepoPrompt as the backend (requires RepoPrompt.app).`
  )
  .version(VERSION, '-v, --version', 'Show version number')
  .helpOption('-h, --help', 'Show help');

// Register all commands
registerCommands(program, getBackend);

// Parse and execute
program.parseAsync(process.argv).catch((error) => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
