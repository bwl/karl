#!/usr/bin/env bun
/**
 * Ivo CLI - Context Intelligence Engine
 *
 * Named after Ivo Karlović, the elite scout who knows where to aim.
 * Ivo prepares optimal context before your AI code agent serves.
 */

import { join } from 'path';
import { homedir } from 'os';
import { Command } from 'commander';
import { registerCommands } from './commands/index.js';
import { NativeBackend } from './backends/native.js';
import type { IvoBackend } from './backends/types.js';
import { registerBuiltinStrategies } from './slicer/strategies/index.js';
import { loadExternalStrategies } from './slicer/registry.js';

const VERSION = '0.1.0';

// Register built-in strategies
registerBuiltinStrategies();

// Load external strategy plugins
await loadExternalStrategies([
  join(homedir(), '.config', 'ivo', 'strategies'),
  join(process.cwd(), '.ivo', 'strategies'),
]);

// Cached backend instance
let backendInstance: IvoBackend | undefined;

async function getBackend(): Promise<IvoBackend> {
  if (!backendInstance) {
    backendInstance = new NativeBackend();
  }
  return backendInstance;
}

const program = new Command();

program
  .name('ivo')
  .description(
    `Ivo - Context Intelligence Engine

Ivo prepares optimal context for AI code agents.
Like a tennis scout who analyzes the court, Ivo identifies
the most relevant files and builds efficient context.`
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
