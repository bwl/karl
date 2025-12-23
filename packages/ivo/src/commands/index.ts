/**
 * Command Registration
 */

import type { Command } from 'commander';
import type { IvoBackend } from '../backends/types.js';

export { registerTreeCommand } from './tree.js';
export { registerSearchCommand } from './search.js';
export { registerStructureCommand } from './structure.js';
export { registerSelectCommand } from './select.js';
export { registerContextCommand } from './context.js';
export { registerBucketCommand } from './bucket.js';

import { registerTreeCommand } from './tree.js';
import { registerSearchCommand } from './search.js';
import { registerStructureCommand } from './structure.js';
import { registerSelectCommand } from './select.js';
import { registerContextCommand } from './context.js';
import { registerBucketCommand } from './bucket.js';

/**
 * Register all commands
 */
export function registerCommands(program: Command, getBackend: () => Promise<IvoBackend>): void {
  registerTreeCommand(program, getBackend);
  registerSearchCommand(program, getBackend);
  registerStructureCommand(program, getBackend);
  registerSelectCommand(program, getBackend);
  registerContextCommand(program, getBackend);
  registerBucketCommand(program, getBackend);
}
