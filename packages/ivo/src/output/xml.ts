/**
 * XML Output Formatter
 *
 * Generates XML output optimized for Claude/Anthropic models.
 * Anthropic explicitly recommends XML tags for structuring prompts.
 */

import type { ContextResult, ContextFile } from '../types.js';

/**
 * Escape special characters for XML content
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Wrap content in CDATA if it contains special characters
 */
function wrapContent(content: string): string {
  if (content.includes(']]>')) {
    // CDATA cannot contain ]]>, so we need to escape it
    content = content.replace(/\]\]>/g, ']]]]><![CDATA[>');
  }
  return `<![CDATA[${content}]]>`;
}

/**
 * Format a single file entry
 */
function formatFile(file: ContextFile, indent: string = '    '): string {
  const attrs = [
    `path="${escapeXml(file.path)}"`,
    `tokens="${file.tokens}"`,
    `mode="${file.mode}"`,
  ];

  if (file.relevance !== undefined) {
    attrs.push(`relevance="${file.relevance.toFixed(2)}"`);
  }

  const lines: string[] = [];
  lines.push(`${indent}<file ${attrs.join(' ')}>`);

  if (file.content) {
    lines.push(`${indent}  <content>${wrapContent(file.content)}</content>`);
  }

  if (file.codemap) {
    lines.push(`${indent}  <codemap>${wrapContent(file.codemap)}</codemap>`);
  }

  lines.push(`${indent}</file>`);
  return lines.join('\n');
}

/**
 * Format ContextResult as XML
 */
export function formatXml(result: ContextResult): string {
  const lines: string[] = [];

  // XML declaration
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');

  // Root element with metadata
  const rootAttrs = [
    'version="1.0"',
    `generated="${new Date().toISOString()}"`,
  ];
  lines.push(`<ivo_context ${rootAttrs.join(' ')}>`);

  // Task
  if (result.task) {
    lines.push(`  <task>${escapeXml(result.task)}</task>`);
  }

  // Summary
  lines.push('  <summary>');
  lines.push(`    <total_files>${result.files.length}</total_files>`);
  lines.push(`    <total_tokens>${result.totalTokens}</total_tokens>`);
  if (result.budget) {
    lines.push(`    <budget>${result.budget}</budget>`);
    const usage = ((result.totalTokens / result.budget) * 100).toFixed(1);
    lines.push(`    <budget_usage>${usage}%</budget_usage>`);
  }
  lines.push('  </summary>');

  // Prompt (instructions)
  if (result.prompt) {
    lines.push('  <prompt>');
    lines.push(`    ${wrapContent(result.prompt)}`);
    lines.push('  </prompt>');
  }

  // History
  if (result.history) {
    lines.push('  <history>');
    lines.push(`    <source>${escapeXml(result.history.source)}</source>`);
    lines.push(`    <mode>${escapeXml(result.history.mode)}</mode>`);
    const historyPayload = JSON.stringify(result.history.entries, null, 2);
    lines.push(`    <entries>${wrapContent(historyPayload)}</entries>`);
    lines.push('  </history>');
  }

  // Directory structure
  if (result.tree) {
    lines.push('  <directory_structure>');
    lines.push(`    ${wrapContent(result.tree)}`);
    lines.push('  </directory_structure>');
  }

  // Files
  if (result.files.length > 0) {
    lines.push('  <files>');
    for (const file of result.files) {
      lines.push(formatFile(file, '    '));
    }
    lines.push('  </files>');
  }

  // Implementation plan
  if (result.plan) {
    lines.push('  <plan>');
    lines.push(`    ${wrapContent(result.plan)}`);
    lines.push('  </plan>');
  }

  // Close root
  lines.push('</ivo_context>');

  return lines.join('\n');
}

/**
 * Format a minimal context (just files, no wrapper)
 */
export function formatXmlMinimal(files: ContextFile[]): string {
  const lines: string[] = [];

  lines.push('<files>');
  for (const file of files) {
    lines.push(formatFile(file, '  '));
  }
  lines.push('</files>');

  return lines.join('\n');
}

export default formatXml;
