/**
 * Context Command - Build optimal context for a task
 *
 * Builds context and saves to .ivo/contexts/{id}.xml
 * Returns a summary with git-style ID for use with any AI code agent.
 */

import type { Command } from 'commander';
import type { IvoBackend } from '../backends/types.js';
import type { ContextOptions, OutputFormat } from '../types.js';
import { formatContext } from '../output/index.js';
import { saveContext } from '../context-store.js';
import { loadConfig } from '../config.js';
import { getUsageHint, getExampleHints } from '../hints.js';

export function registerContextCommand(program: Command, getBackend: () => Promise<IvoBackend>): void {
  program
    .command('context [keywords]')
    .alias('ctx')
    .description('Build context by searching for keywords in the codebase')
    .option('-b, --budget <n>', 'Token budget limit', parseInt)
    .option('-f, --format <format>', 'Output format: xml, markdown, or json')
    .option('--full', 'Output full context instead of summary + ID')
    .option('--snapshot', 'Get current context snapshot (no keyword search)')
    .addHelpText(
      'after',
      `
Keywords:
  Ivo searches your codebase for the keywords you provide and auto-expands
  them with common synonyms (e.g., "auth" also searches login, session, jwt).

  Set IVO_LLM_ENDPOINT or run 'ivo setup' for AI-powered expansion.
  Results are cached in .ivo/cache/synonyms.json.

  Up to 20 expanded keywords are used. Stopwords (the, and, for, etc.) are ignored.

Examples:
  # Search with synonyms for best coverage
  ivo context "auth, login, session, jwt, token"
  # Output: a7b2c3d  45 files  28.5k tokens  (89% of 32k)

  # Use the context ID with your agent
  ivo get a7b2c3d | claude -p "fix the auth bug"
  karl run "fix the auth bug" --context a7b2c3d
  ivo get a7b2c3d | codex exec -
  ivo get a7b2c3d | pbcopy

  # Bug hunting - include error-related terms
  ivo context "timeout, error, retry, connection, socket"

  # Feature exploration
  ivo context "cache, redis, store, persist, ttl"

  # Limit token budget
  ivo context "api, endpoint, route, handler" --budget 16000

  # Output full context instead of summary
  ivo context "database, query, sql" --full

  # Get current selection snapshot (no search)
  ivo context --snapshot
`
    )
    .action(async (task: string | undefined, options) => {
      try {
        const backend = await getBackend();
        const config = await loadConfig();
        const budget = options.budget ?? config.defaults?.budget ?? 32000;
        const format = (options.format ?? config.defaults?.format ?? 'xml') as OutputFormat;

        const contextOpts: ContextOptions = {
          format,
          budget,
        };

        let result;

        if (options.snapshot || !task) {
          // Get current context without AI exploration
          result = await backend.getWorkspaceContext(contextOpts);
          if (task) {
            result.task = task;
          }
        } else {
          // Build context by searching for keywords
          console.error(`Searching: ${task}`);
          result = await backend.buildContext(task, contextOpts);
        }

        // If --full flag, output full context
        if (options.full) {
          const output = formatContext(result, format);
          console.log(output);
          return;
        }

        // Save context and output summary + ID
        const content = formatContext(result, format);
        const meta = await saveContext(content, {
          task: result.task,
          files: result.files.length,
          tokens: result.totalTokens,
          budget,
        });

        // Print bill of goods - strategy breakdown
        const usage = budget > 0 ? `(${((result.totalTokens / budget) * 100).toFixed(0)}% of ${formatTokens(budget)})` : '';
        console.log(`${meta.id}  ${result.files.length} files  ${formatTokens(result.totalTokens)} tokens  ${usage}`);
        console.log('');

        // Strategy breakdown
        if (result.strategies && Object.keys(result.strategies).length > 0) {
          // Sort strategies by token count descending
          const sortedStrategies = Object.entries(result.strategies)
            .sort((a, b) => b[1].tokens - a[1].tokens);

          for (const [strategy, stats] of sortedStrategies) {
            const countStr = stats.count > 0 ? `${stats.count} files` : '';
            const tokensStr = formatTokens(stats.tokens);
            console.log(`  ${strategy.padEnd(12)} ${countStr.padStart(10)}  ${tokensStr.padStart(6)}`);
          }
        }

        // Hint for usage (rotates between agents)
        console.log('');
        console.log(getUsageHint(meta.id));
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
