/**
 * JSON Output Formatter
 *
 * Machine-readable format for programmatic access and tooling.
 */

import type { ContextResult, ContextFile, SelectionResult, SearchResult, StructureResult } from '../types.js';

/**
 * Format ContextResult as JSON
 */
export function formatJson(result: ContextResult, pretty: boolean = true): string {
  const output = {
    version: '1.0',
    generated: new Date().toISOString(),
    task: result.task || undefined,
    summary: {
      totalFiles: result.files.length,
      totalTokens: result.totalTokens,
      budget: result.budget,
      budgetUsage: result.budget
        ? Number(((result.totalTokens / result.budget) * 100).toFixed(1))
        : undefined,
      filesByMode: {
        full: result.files.filter((f) => f.mode === 'full').length,
        codemap: result.files.filter((f) => f.mode === 'codemap').length,
        slice: result.files.filter((f) => f.mode === 'slice').length,
      },
    },
    prompt: result.prompt,
    tree: result.tree,
    files: result.files.map((f) => ({
      path: f.path,
      tokens: f.tokens,
      mode: f.mode,
      relevance: f.relevance,
      content: f.content,
      codemap: f.codemap,
    })),
    plan: result.plan,
    chatId: result.chatId,
  };

  // Remove undefined values
  const clean = JSON.parse(JSON.stringify(output));

  return pretty ? JSON.stringify(clean, null, 2) : JSON.stringify(clean);
}

/**
 * Format SelectionResult as JSON
 */
export function formatSelectionJson(result: SelectionResult, pretty: boolean = true): string {
  const output = {
    totalTokens: result.totalTokens,
    fileCount: result.files.length,
    prompt: result.prompt,
    files: result.files.map((f) => ({
      path: f.path,
      tokens: f.tokens,
      mode: f.mode,
      slices: f.slices?.map((s) => ({
        startLine: s.startLine,
        endLine: s.endLine,
        description: s.description,
      })),
    })),
  };

  const clean = JSON.parse(JSON.stringify(output));
  return pretty ? JSON.stringify(clean, null, 2) : JSON.stringify(clean);
}

/**
 * Format SearchResult as JSON
 */
export function formatSearchJson(result: SearchResult, pretty: boolean = true): string {
  const output = {
    pattern: result.pattern,
    totalMatches: result.totalMatches,
    truncated: result.truncated,
    matches: result.matches.map((m) => ({
      path: m.path,
      line: m.line,
      content: m.content,
      context: m.context,
    })),
  };

  return pretty ? JSON.stringify(output, null, 2) : JSON.stringify(output);
}

/**
 * Format StructureResult as JSON
 */
export function formatStructureJson(result: StructureResult, pretty: boolean = true): string {
  const output = {
    codemapCount: result.codemaps.length,
    filesWithoutCodemap: result.filesWithoutCodemap,
    codemaps: result.codemaps.map((cm) => ({
      path: cm.path,
      language: cm.language,
      exports: cm.exports,
      classes: cm.classes,
      functions: cm.functions,
      types: cm.types,
      dependencies: cm.dependencies,
    })),
  };

  return pretty ? JSON.stringify(output, null, 2) : JSON.stringify(output);
}

export default formatJson;
