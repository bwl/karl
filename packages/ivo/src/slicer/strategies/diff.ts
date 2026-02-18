/**
 * Diff Strategy — include recently changed files from git
 */

import { join } from 'path';
import type { StrategyPlugin, StrategyContext, StrategyResult } from '../strategy.js';
import type { SliceCandidate } from '../types.js';
import { getGitDiffPaths, isPathIncluded, loadFileContent, estimateTokens, makeReferenceAlternate, scoreCandidate } from '../utils.js';

export default (): StrategyPlugin => ({
  name: 'diff',
  defaultWeight: 0.60,
  defaultBudgetCap: 0.10,

  async isAvailable() { return true; },

  async execute(ctx: StrategyContext): Promise<StrategyResult> {
    const diffLimit = ctx.intensity === 'lite' ? 6 : ctx.intensity === 'deep' ? 20 : 12;
    const diffPaths = await getGitDiffPaths(ctx.repoRoot);
    const candidates: SliceCandidate[] = [];
    const warnings: string[] = [];

    if (diffPaths.length === 0) {
      warnings.push('Diff strategy skipped: no git changes detected.');
      return { candidates, warnings };
    }

    for (const path of diffPaths.slice(0, diffLimit)) {
      if (!isPathIncluded(path, ctx.request)) continue;
      const fullPath = join(ctx.repoRoot, path);
      const content = await loadFileContent(fullPath);
      if (!content) continue;

      const tokens = estimateTokens(content);
      candidates.push({
        id: `diff:${path}`,
        path,
        strategy: 'diff' as const,
        representation: 'full' as const,
        score: scoreCandidate('diff', 1, tokens, ctx.budgetTokens),
        tokens,
        reason: 'Recently changed file',
        source: 'git diff',
        content,
        alternates: [makeReferenceAlternate(path, 'diff reference')],
      });
      ctx.matchedFiles.add(path);
    }

    return { candidates, warnings };
  },
});
