/**
 * Tree Command - Display file tree
 */

import type { Command } from 'commander';
import type { IvoBackend } from '../backends/types.js';
import type { TreeOptions } from '../types.js';

export function registerTreeCommand(program: Command, getBackend: () => Promise<IvoBackend>): void {
  program
    .command('tree')
    .description('Display file tree of the workspace')
    .option('--folders', 'Show directories only')
    .option('-m, --mode <mode>', 'Tree mode: full, folders, or selected', 'full')
    .option('-p, --path <path>', 'Starting path')
    .option('-d, --depth <n>', 'Maximum depth', parseInt)
    .action(async (options) => {
      try {
        const backend = await getBackend();

        const treeOpts: TreeOptions = {
          mode: options.folders ? 'folders' : (options.mode as 'full' | 'folders' | 'selected'),
          path: options.path,
          maxDepth: options.depth,
        };

        const result = await backend.getTree(treeOpts);
        console.log(result);
      } catch (error) {
        if (error instanceof Error) {
          console.error(`Error: ${error.message}`);
          process.exit(1);
        }
        throw error;
      }
    });
}
