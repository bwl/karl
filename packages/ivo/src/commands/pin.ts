/**
 * Pin/Unpin Commands - Pin contexts to prevent auto-cleanup
 */

import type { Command } from 'commander';
import {
  pinContext,
  unpinContext,
  findContextById,
  loadContextMeta,
} from '../context-store.js';

export function registerPinCommand(program: Command): void {
  program
    .command('pin <id>')
    .description('Pin a saved context to prevent auto-cleanup')
    .action(async (id: string) => {
      const cwd = process.cwd();

      // Resolve partial ID
      let meta = await loadContextMeta(id, cwd);
      if (!meta) {
        meta = await findContextById(id, cwd);
      }
      if (!meta) {
        console.error(`Context not found: ${id}`);
        process.exit(1);
      }

      const success = await pinContext(meta.id, cwd);
      if (success) {
        console.log(`Pinned: ${meta.id} (${meta.task.slice(0, 50)})`);
      } else {
        console.error(`Failed to pin context: ${meta.id}`);
        process.exit(1);
      }
    });

  program
    .command('unpin <id>')
    .description('Unpin a context to allow auto-cleanup')
    .action(async (id: string) => {
      const cwd = process.cwd();

      let meta = await loadContextMeta(id, cwd);
      if (!meta) {
        meta = await findContextById(id, cwd);
      }
      if (!meta) {
        console.error(`Context not found: ${id}`);
        process.exit(1);
      }

      const success = await unpinContext(meta.id, cwd);
      if (success) {
        console.log(`Unpinned: ${meta.id}`);
      } else {
        console.error(`Failed to unpin context: ${meta.id}`);
        process.exit(1);
      }
    });
}
