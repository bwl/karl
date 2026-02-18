/**
 * Explicit Strategy — extracts file paths referenced in the task text
 */

import { stat } from 'fs/promises';
import { join } from 'path';
import { detectLanguage, extractCodemap, formatCodemapCompact } from '../../codemap/index.js';
import type { StrategyPlugin, StrategyContext, StrategyResult } from '../strategy.js';
import { estimateTokens, isPathIncluded, loadFileContent, makeReferenceAlternate, scoreCandidate } from '../utils.js';
import type { SliceAlternate } from '../types.js';

async function extractExplicitPaths(task: string, repoRoot: string): Promise<string[]> {
  const tokens = task.match(/[A-Za-z0-9_./\-]+/g) ?? [];
  const candidates = tokens.filter((token) => token.includes('/') || token.includes('.'));
  const found: string[] = [];

  for (const token of candidates) {
    const fullPath = join(repoRoot, token);
    try {
      const stats = await stat(fullPath);
      if (stats.isFile()) found.push(token);
    } catch { /* skip */ }
  }

  return Array.from(new Set(found));
}

export default (): StrategyPlugin => ({
  name: 'explicit',
  defaultWeight: 0.95,

  async isAvailable() { return true; },

  async execute(ctx: StrategyContext): Promise<StrategyResult> {
    const candidates = [];
    const paths = await extractExplicitPaths(ctx.request.task, ctx.repoRoot);

    for (const path of paths) {
      if (!isPathIncluded(path, ctx.request)) continue;
      const fullPath = join(ctx.repoRoot, path);
      const content = await loadFileContent(fullPath);
      if (!content) continue;

      const tokens = estimateTokens(content);
      const alternates: SliceAlternate[] = [makeReferenceAlternate(path, 'explicit reference')];

      if (detectLanguage(path)) {
        const codemap = await extractCodemap(fullPath, content);
        if (codemap) {
          const compact = formatCodemapCompact(codemap);
          alternates.unshift({ representation: 'codemap', tokens: estimateTokens(compact), codemap: compact });
        }
      }

      candidates.push({
        id: `explicit:${path}`,
        path,
        strategy: 'explicit' as const,
        representation: 'full' as const,
        score: scoreCandidate('explicit', 1, tokens, ctx.budgetTokens),
        tokens,
        reason: 'Explicit path referenced in task',
        source: 'task',
        content,
        alternates,
      });
      ctx.matchedFiles.add(path);
    }

    return { candidates };
  },
});
