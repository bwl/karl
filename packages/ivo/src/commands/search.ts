/**
 * Search Command - Search files by pattern
 */

import type { Command } from 'commander';
import type { IvoBackend } from '../backends/types.js';
import type { SearchOptions } from '../types.js';
import { formatSearchJson } from '../output/json.js';

export function registerSearchCommand(program: Command, getBackend: () => Promise<IvoBackend>): void {
  program
    .command('search <pattern>')
    .description('Search files by pattern (path or content)')
    .option('-m, --mode <mode>', 'Search mode: auto, path, content, or both', 'auto')
    .option('-e, --extensions <exts>', 'File extensions (comma-separated)', (v) => v.split(','))
    .option('-C, --context <n>', 'Context lines around matches', parseInt)
    .option('-n, --max <n>', 'Maximum results', parseInt)
    .option('--no-regex', 'Treat pattern as literal string')
    .option('-i, --ignore-case', 'Case insensitive search')
    .option('--json', 'Output as JSON')
    .action(async (pattern: string, options) => {
      try {
        const backend = await getBackend();

        const searchOpts: SearchOptions = {
          mode: options.mode as 'auto' | 'path' | 'content' | 'both',
          extensions: options.extensions,
          contextLines: options.context,
          maxResults: options.max,
          regex: options.regex !== false,
          caseInsensitive: options.ignoreCase,
        };

        const result = await backend.search(pattern, searchOpts);

        if (options.json) {
          console.log(formatSearchJson(result));
        } else {
          // Human-readable output
          if (result.matches.length === 0) {
            console.log('No matches found.');
            return;
          }

          console.log(`Found ${result.totalMatches} matches${result.truncated ? ' (truncated)' : ''}:\n`);

          for (const match of result.matches) {
            if (match.line > 0) {
              console.log(`${match.path}:${match.line}`);
              if (match.context?.before?.length) {
                for (const line of match.context.before) {
                  console.log(`  ${line}`);
                }
              }
              console.log(`> ${match.content}`);
              if (match.context?.after?.length) {
                for (const line of match.context.after) {
                  console.log(`  ${line}`);
                }
              }
              console.log('');
            } else {
              console.log(match.path);
            }
          }
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
