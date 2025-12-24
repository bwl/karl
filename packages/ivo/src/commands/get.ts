/**
 * Get Command - Retrieve saved context by ID
 */

import type { Command } from 'commander';
import {
  loadContext,
  loadContextMeta,
  listContexts,
  findContextById,
  type ContextMeta,
} from '../context-store.js';

function formatTokens(tokens: number): string {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  return String(tokens);
}

function formatAge(createdAt: string): string {
  const age = Date.now() - new Date(createdAt).getTime();
  const minutes = Math.floor(age / 60000);
  const hours = Math.floor(age / 3600000);
  const days = Math.floor(age / 86400000);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}

/**
 * Extract a section from XML content by tag name.
 * Handles CDATA sections within the tag.
 */
function extractSection(content: string, tagName: string): string | null {
  const regex = new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, 'i');
  const match = content.match(regex);
  if (!match) return null;

  let text = match[1].trim();
  // Handle CDATA sections
  const cdataMatch = text.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  if (cdataMatch) {
    text = cdataMatch[1];
  }
  return text;
}

/**
 * Try multiple tag names for a section.
 */
function extractSectionMulti(content: string, tagNames: string[]): string | null {
  for (const tagName of tagNames) {
    const result = extractSection(content, tagName);
    if (result) return result;
  }
  return null;
}

/**
 * Extract file paths from context XML.
 */
function extractFilePaths(content: string): string[] {
  const paths: string[] = [];
  const fileRegex = /<file\s+path="([^"]+)"/g;
  let match;
  while ((match = fileRegex.exec(content)) !== null) {
    paths.push(match[1]);
  }
  return paths;
}

export function registerGetCommand(program: Command): void {
  program
    .command('get [id]')
    .description('Retrieve saved context by ID')
    .option('--list', 'List all saved contexts')
    .option('--meta', 'Show only metadata')
    .option('--tree', 'Show only the tree section')
    .option('--files', 'Show only file paths')
    .option('--task', 'Show only the task')
    .option('--raw', 'Output raw XML content')
    .option('--json', 'Output as JSON')
    .addHelpText(
      'after',
      `
Examples:
  # List all saved contexts
  ivo get --list

  # Get full context by ID
  ivo get a7b2c3d

  # Get just metadata
  ivo get a7b2c3d --meta

  # Get just the tree section
  ivo get a7b2c3d --tree

  # Get file paths only
  ivo get a7b2c3d --files

  # Output raw XML
  ivo get a7b2c3d --raw

  # Partial ID matching (like git)
  ivo get a7b
`
    )
    .action(async (id: string | undefined, options) => {
      try {
        const cwd = process.cwd();

        // List mode
        if (options.list || !id) {
          const contexts = await listContexts(cwd);

          if (contexts.length === 0) {
            console.log('No saved contexts found.');
            console.log('Use: ivo context "task" to create one.');
            return;
          }

          if (options.json) {
            console.log(JSON.stringify(contexts, null, 2));
            return;
          }

          console.log('Saved contexts:\n');
          for (const ctx of contexts) {
            const usage = ctx.budget > 0
              ? `(${((ctx.tokens / ctx.budget) * 100).toFixed(0)}%)`
              : '';
            const age = formatAge(ctx.createdAt);
            const task = ctx.task.length > 40
              ? ctx.task.slice(0, 37) + '...'
              : ctx.task;
            console.log(
              `  ${ctx.id}  ${String(ctx.files).padStart(3)} files  ${formatTokens(ctx.tokens).padStart(6)} ${usage.padStart(5)}  ${age.padStart(8)}  ${task}`
            );
          }
          console.log('');
          console.log('Use: ivo get <id> to retrieve a context');
          return;
        }

        // Find context by ID (supports partial matching)
        let meta: ContextMeta | null = await loadContextMeta(id, cwd);

        if (!meta) {
          // Try partial match
          meta = await findContextById(id, cwd);

          if (!meta) {
            // Check if ambiguous
            const contexts = await listContexts(cwd);
            const matches = contexts.filter(c => c.id.startsWith(id));

            if (matches.length > 1) {
              console.error(`Ambiguous ID '${id}' matches ${matches.length} contexts:`);
              for (const m of matches) {
                console.error(`  ${m.id}  ${m.task.slice(0, 40)}`);
              }
              process.exit(1);
            }

            console.error(`Context not found: ${id}`);
            process.exit(1);
          }
        }

        // Meta-only mode
        if (options.meta) {
          if (options.json) {
            console.log(JSON.stringify(meta, null, 2));
          } else {
            console.log(`ID:      ${meta.id}`);
            console.log(`Task:    ${meta.task}`);
            console.log(`Files:   ${meta.files}`);
            console.log(`Tokens:  ${formatTokens(meta.tokens)} / ${formatTokens(meta.budget)}`);
            console.log(`Created: ${meta.createdAt}`);
          }
          return;
        }

        // Load full content
        const content = await loadContext(meta.id, cwd);
        if (!content) {
          console.error(`Context file not found: ${meta.id}`);
          process.exit(1);
        }

        // Raw mode - just output the content
        if (options.raw) {
          console.log(content);
          return;
        }

        // Tree-only mode
        if (options.tree) {
          const tree = extractSectionMulti(content, ['tree', 'directory_structure']);
          if (tree) {
            console.log(tree);
          } else {
            console.error('No tree section found in context.');
            process.exit(1);
          }
          return;
        }

        // Task-only mode
        if (options.task) {
          const task = extractSection(content, 'task');
          if (task) {
            console.log(task);
          } else {
            console.log(meta.task);
          }
          return;
        }

        // Files-only mode
        if (options.files) {
          const paths = extractFilePaths(content);
          if (options.json) {
            console.log(JSON.stringify(paths, null, 2));
          } else {
            for (const p of paths) {
              console.log(p);
            }
          }
          return;
        }

        // Default: show summary + content preview
        if (options.json) {
          const paths = extractFilePaths(content);
          const tree = extractSectionMulti(content, ['tree', 'directory_structure']);
          console.log(JSON.stringify({
            meta,
            tree,
            files: paths,
            contentLength: content.length,
          }, null, 2));
        } else {
          console.log(`Context: ${meta.id}`);
          console.log(`Task:    ${meta.task}`);
          console.log(`Files:   ${meta.files}`);
          console.log(`Tokens:  ${formatTokens(meta.tokens)} / ${formatTokens(meta.budget)}`);
          console.log('');

          // Show file list
          const paths = extractFilePaths(content);
          if (paths.length > 0) {
            console.log('Files:');
            for (const p of paths.slice(0, 20)) {
              console.log(`  ${p}`);
            }
            if (paths.length > 20) {
              console.log(`  ... and ${paths.length - 20} more`);
            }
          }

          console.log('');
          console.log(`Use: ivo get ${meta.id} --raw  to output full XML`);
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
