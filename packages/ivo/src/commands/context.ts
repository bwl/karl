/**
 * Context Command - Build optimal context for a task
 *
 * This is the main feature of Ivo - using AI-powered exploration
 * to select the most relevant files for a task.
 */

import type { Command } from 'commander';
import type { IvoBackend } from '../backends/types.js';
import type { ContextHistoryOptions, ContextOptions, OutputFormat } from '../types.js';
import { formatContext } from '../output/index.js';
import { loadHistoryContext } from '../history.js';

export function registerContextCommand(program: Command, getBackend: () => Promise<IvoBackend>): void {
  program
    .command('context [task]')
    .alias('ctx')
    .description('Build optimal context for a task using AI-powered exploration')
    .option('-f, --format <format>', 'Output format: xml, markdown, or json', 'xml')
    .option('-b, --budget <n>', 'Token budget limit', parseInt)
    .option('-p, --plan', 'Include implementation plan')
    .option('--question', 'Ask a question about the codebase')
    .option('--include <items>', 'What to include: prompt,selection,code,files,tree,tokens,history', (v) =>
      v.split(',')
    )
    .option('--history', 'Include recent run history')
    .option('--history-id <id>', 'Include a specific history entry by id')
    .option('--history-limit <n>', 'Max history entries to include', parseInt)
    .option('--history-full', 'Include full history records')
    .option('--history-tag <tag>', 'Filter history by tag (repeatable)', collect)
    .option('--history-status <status>', 'Filter history by status (success|error)')
    .option('--history-stack <name>', 'Filter history by stack')
    .option('--history-model <name>', 'Filter history by model key')
    .option('--history-skill <name>', 'Filter history by skill')
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

  # Include latest history entry
  ivo context "Follow up" --history

  # Include last 3 history entries with full records
  ivo context "Follow up" --history --history-limit 3 --history-full
`
    )
    .action(async (task: string | undefined, options) => {
      try {
        const backend = await getBackend();

        const format = options.format as OutputFormat;
        const include = options.include as ContextOptions['include'];
        const historyOptions = buildHistoryOptions(options, include);
        const contextOpts: ContextOptions = {
          format,
          budget: options.budget,
          includePlan: options.plan,
          responseType: options.plan ? 'plan' : options.question ? 'question' : undefined,
          include,
          history: historyOptions,
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

        if (historyOptions) {
          try {
            const history = await loadHistoryContext(historyOptions, process.cwd());
            if (history) {
              result.history = history;
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`History unavailable: ${message}`);
          }
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

function collect(value: string, previous: string[] | undefined): string[] {
  const next = previous ? [...previous] : [];
  if (value && value.trim()) {
    next.push(value.trim());
  }
  return next;
}

function buildHistoryOptions(
  options: Record<string, unknown>,
  include: ContextOptions['include']
): ContextHistoryOptions | undefined {
  const includeHistory = Boolean(
    options.history ||
      options.historyId ||
      options.historyLimit ||
      options.historyFull ||
      options.historyTag ||
      options.historyStatus ||
      options.historyStack ||
      options.historyModel ||
      options.historySkill ||
      include?.includes('history')
  );

  if (!includeHistory) {
    return undefined;
  }

  const limitValue = typeof options.historyLimit === 'number' ? options.historyLimit : undefined;

  return {
    id: typeof options.historyId === 'string' ? options.historyId : undefined,
    limit: limitValue,
    full: Boolean(options.historyFull),
    tag: Array.isArray(options.historyTag) ? options.historyTag : undefined,
    status: options.historyStatus === 'success' || options.historyStatus === 'error' ? options.historyStatus : undefined,
    stack: typeof options.historyStack === 'string' ? options.historyStack : undefined,
    model: typeof options.historyModel === 'string' ? options.historyModel : undefined,
    skill: typeof options.historySkill === 'string' ? options.historySkill : undefined,
  };
}
