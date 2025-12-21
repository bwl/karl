/**
 * Select Command - Manage file selection
 */

import type { Command } from 'commander';
import type { IvoBackend } from '../backends/types.js';
import { formatSelectionJson } from '../output/json.js';

type SelectOp = 'list' | 'add' | 'set' | 'remove' | 'clear';

export function registerSelectCommand(program: Command, getBackend: () => Promise<IvoBackend>): void {
  program
    .command('select <operation> [paths...]')
    .alias('sel')
    .description('Manage file selection (list, add, set, remove, clear)')
    .option('--json', 'Output as JSON')
    .addHelpText(
      'after',
      `
Operations:
  list              Show current selection with token counts
  add <paths...>    Add files/directories to selection
  set <paths...>    Replace selection with specified paths
  remove <paths...> Remove files/directories from selection
  clear             Clear all selection

Examples:
  ivo select list
  ivo select add src/auth/
  ivo select set src/api/ src/utils/
  ivo select remove tests/
  ivo select clear
`
    )
    .action(async (operation: string, paths: string[], options) => {
      try {
        const backend = await getBackend();
        const op = operation.toLowerCase() as SelectOp;

        switch (op) {
          case 'list': {
            const result = await backend.getSelection();

            if (options.json) {
              console.log(formatSelectionJson(result));
            } else {
              if (result.files.length === 0) {
                console.log('No files selected.');
                return;
              }

              console.log(`Selection (${result.files.length} files, ${formatTokens(result.totalTokens)} tokens):\n`);

              // Group by mode
              const byMode = {
                full: result.files.filter((f) => f.mode === 'full'),
                codemap: result.files.filter((f) => f.mode === 'codemap'),
                slice: result.files.filter((f) => f.mode === 'slice'),
              };

              for (const [mode, files] of Object.entries(byMode)) {
                if (files.length === 0) continue;

                const modeTokens = files.reduce((sum, f) => sum + f.tokens, 0);
                console.log(`${mode.toUpperCase()} (${files.length} files, ${formatTokens(modeTokens)} tokens):`);

                for (const file of files) {
                  let line = `  ${file.path} (${formatTokens(file.tokens)})`;
                  if (file.slices?.length) {
                    const ranges = file.slices
                      .map((s) => `${s.startLine}-${s.endLine}`)
                      .join(', ');
                    line += ` [lines: ${ranges}]`;
                  }
                  console.log(line);
                }
                console.log('');
              }

              if (result.prompt) {
                console.log('Prompt:');
                console.log(result.prompt.slice(0, 200) + (result.prompt.length > 200 ? '...' : ''));
              }
            }
            break;
          }

          case 'add': {
            if (paths.length === 0) {
              console.error('Error: No paths specified');
              process.exit(1);
            }
            await backend.addToSelection(paths);
            console.log(`Added ${paths.length} path(s) to selection.`);
            break;
          }

          case 'set': {
            if (paths.length === 0) {
              console.error('Error: No paths specified');
              process.exit(1);
            }
            await backend.setSelection(paths);
            console.log(`Selection set to ${paths.length} path(s).`);
            break;
          }

          case 'remove': {
            if (paths.length === 0) {
              console.error('Error: No paths specified');
              process.exit(1);
            }
            await backend.removeFromSelection(paths);
            console.log(`Removed ${paths.length} path(s) from selection.`);
            break;
          }

          case 'clear': {
            await backend.clearSelection();
            console.log('Selection cleared.');
            break;
          }

          default:
            console.error(`Unknown operation: ${operation}`);
            console.error('Valid operations: list, add, set, remove, clear');
            process.exit(1);
        }
      } catch (error) {
        if (error instanceof Error) {
          console.error(`Error: ${error.message}`);
          process.exit(1);
        }
        throw error;
      }
    });
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  return String(tokens);
}
