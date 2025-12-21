/**
 * Context Command - Build optimal context for a task
 *
 * This is the main feature of Ivo - using AI-powered exploration
 * to select the most relevant files for a task.
 */

import type { Command } from 'commander';
import type { IvoBackend } from '../backends/types.js';
import type { ContextOptions, OutputFormat } from '../types.js';
import { formatContext } from '../output/index.js';

export function registerContextCommand(program: Command, getBackend: () => Promise<IvoBackend>): void {
  program
    .command('context [task]')
    .alias('ctx')
    .description('Build optimal context for a task using AI-powered exploration')
    .option('-f, --format <format>', 'Output format: xml, markdown, or json', 'xml')
    .option('-b, --budget <n>', 'Token budget limit', parseInt)
    .option('-p, --plan', 'Include implementation plan')
    .option('--question', 'Ask a question about the codebase')
    .option('--include <items>', 'What to include: prompt,selection,code,files,tree,tokens', (v) =>
      v.split(',')
    )
    .option('--snapshot', 'Get current context snapshot (no AI exploration)')
    .addHelpText(
      'after',
      `
Examples:
  # Build context for a task with AI exploration
  ivo context "Fix the authentication timeout bug"

  # Include an implementation plan
  ivo context "Add caching to the API" --plan

  # Ask a question about the codebase
  ivo context "How does the auth flow work?" --question

  # Get current context snapshot (no AI)
  ivo context --snapshot

  # Specify output format
  ivo context "Review security" --format markdown

  # Limit token budget
  ivo context "Refactor utils" --budget 32000
`
    )
    .action(async (task: string | undefined, options) => {
      try {
        const backend = await getBackend();

        const format = options.format as OutputFormat;
        const contextOpts: ContextOptions = {
          format,
          budget: options.budget,
          includePlan: options.plan,
          responseType: options.plan ? 'plan' : options.question ? 'question' : undefined,
          include: options.include as ContextOptions['include'],
        };

        let result;

        if (options.snapshot || !task) {
          // Get current context without AI exploration
          result = await backend.getWorkspaceContext(contextOpts);
          if (task) {
            result.task = task;
          }
        } else {
          // Use AI-powered context building
          console.error(`Building context for: "${task}"...`);
          console.error('(This may take 30s-5min depending on codebase size)\n');

          result = await backend.buildContext(task, contextOpts);
        }

        // Output the formatted result
        const output = formatContext(result, format);
        console.log(output);

        // Print summary to stderr so it doesn't interfere with piping
        if (!options.snapshot && task) {
          console.error('');
          console.error(`Context built: ${result.files.length} files, ${formatTokens(result.totalTokens)} tokens`);
          if (result.budget) {
            const usage = ((result.totalTokens / result.budget) * 100).toFixed(1);
            console.error(`Budget usage: ${usage}%`);
          }
          if (result.chatId) {
            console.error(`Chat ID: ${result.chatId} (for follow-up with rp-cli)`);
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

function formatTokens(tokens: number): string {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  return String(tokens);
}
