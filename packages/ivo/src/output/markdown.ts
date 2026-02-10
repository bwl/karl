/**
 * Markdown Output Formatter
 *
 * Human-readable format, good for debugging and manual review.
 */

import type { ContextResult, ContextFile } from '../types.js';

/**
 * Format file size in human-readable form
 */
function formatTokens(tokens: number): string {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  return String(tokens);
}

/**
 * Get mode indicator
 */
function getModeIndicator(mode: string): string {
  switch (mode) {
    case 'full':
      return '';
    case 'codemap':
      return ' (codemap)';
    case 'slice':
      return ' (slice)';
    default:
      return ` (${mode})`;
  }
}

/**
 * Format a single file entry
 */
function formatFile(file: ContextFile): string {
  const lines: string[] = [];

  const header = `### ${file.path}`;
  lines.push(header);

  const meta: string[] = [];
  meta.push(`**Tokens**: ${formatTokens(file.tokens)}`);
  meta.push(`**Mode**: ${file.mode}`);
  if (file.strategy) {
    meta.push(`**Strategy**: ${file.strategy}`);
  }
  if (file.relevance !== undefined) {
    meta.push(`**Relevance**: ${(file.relevance * 100).toFixed(0)}%`);
  }
  lines.push(meta.join(' | '));
  if (file.reason) {
    lines.push(`> ${file.reason}`);
  }
  lines.push('');

  if (file.content) {
    // Detect language from extension
    const ext = file.path.split('.').pop() || '';
    const langMap: Record<string, string> = {
      ts: 'typescript',
      tsx: 'tsx',
      js: 'javascript',
      jsx: 'jsx',
      py: 'python',
      rs: 'rust',
      go: 'go',
      java: 'java',
      kt: 'kotlin',
      swift: 'swift',
      c: 'c',
      cpp: 'cpp',
      h: 'c',
      hpp: 'cpp',
      css: 'css',
      scss: 'scss',
      html: 'html',
      json: 'json',
      yaml: 'yaml',
      yml: 'yaml',
      md: 'markdown',
      sql: 'sql',
      sh: 'bash',
      bash: 'bash',
      zsh: 'bash',
    };
    const lang = langMap[ext] || ext || 'text';

    lines.push('```' + lang);
    lines.push(file.content);
    lines.push('```');
  }

  if (file.codemap) {
    lines.push('```');
    lines.push(file.codemap);
    lines.push('```');
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Format ContextResult as Markdown
 */
export function formatMarkdown(result: ContextResult): string {
  const lines: string[] = [];

  // Title
  if (result.task) {
    lines.push(`# Context: ${result.task}`);
  } else {
    lines.push('# Context');
  }
  lines.push('');

  // Summary
  lines.push('## Summary');
  lines.push('');

  const fullFiles = result.files.filter((f) => f.mode === 'full').length;
  const codemapFiles = result.files.filter((f) => f.mode === 'codemap').length;
  const sliceFiles = result.files.filter((f) => f.mode === 'slice').length;

  lines.push(`- **Files**: ${result.files.length} (${fullFiles} full, ${codemapFiles} codemaps, ${sliceFiles} slices)`);
  lines.push(`- **Tokens**: ${formatTokens(result.totalTokens)}${result.budget ? ` / ${formatTokens(result.budget)} budget` : ''}`);

  if (result.budget) {
    const usage = ((result.totalTokens / result.budget) * 100).toFixed(1);
    lines.push(`- **Budget Usage**: ${usage}%`);
  }

  if (result.strategies && Object.keys(result.strategies).length > 0) {
    lines.push('');
    lines.push('| Strategy | Files | Tokens |');
    lines.push('|----------|------:|-------:|');
    for (const [name, stats] of Object.entries(result.strategies)) {
      lines.push(`| ${name} | ${stats.count} | ${formatTokens(stats.tokens)} |`);
    }
  }

  lines.push('');

  // Prompt
  if (result.prompt) {
    lines.push('## Prompt');
    lines.push('');
    lines.push(result.prompt);
    lines.push('');
  }

  // History
  if (result.history) {
    lines.push('## History');
    lines.push('');
    lines.push(`- **Source**: ${result.history.source}`);
    lines.push(`- **Mode**: ${result.history.mode}`);
    lines.push(`- **Entries**: ${result.history.entries.length}`);
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(result.history.entries, null, 2));
    lines.push('```');
    lines.push('');
  }

  // Directory structure
  if (result.tree) {
    lines.push('## Directory Structure');
    lines.push('');
    lines.push('```');
    lines.push(result.tree);
    lines.push('```');
    lines.push('');
  }

  // Files
  if (result.files.length > 0) {
    lines.push('## Files');
    lines.push('');

    for (const file of result.files) {
      lines.push(formatFile(file));
    }
  }

  // Plan
  if (result.plan) {
    lines.push('## Implementation Plan');
    lines.push('');
    lines.push(result.plan);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format a file list as a simple table
 */
export function formatFileTable(files: ContextFile[]): string {
  const lines: string[] = [];

  lines.push('| File | Tokens | Mode |');
  lines.push('|------|--------|------|');

  for (const file of files) {
    lines.push(`| ${file.path} | ${formatTokens(file.tokens)} | ${file.mode} |`);
  }

  return lines.join('\n');
}

export default formatMarkdown;
