/**
 * Keyword Strategy — search-based file discovery via backend
 */

import { join } from 'path';
import type { StrategyPlugin, StrategyContext, StrategyResult } from '../strategy.js';
import type { SliceCandidate } from '../types.js';
import {
  buildSnippet, collectKeywordMatches, estimateTokens, loadFileContent,
  makeReferenceAlternate, scoreCandidate,
} from '../utils.js';

export default (): StrategyPlugin => ({
  name: 'keyword',
  defaultWeight: 0.65,
  defaultBudgetCap: 0.20,

  async isAvailable() { return true; },

  async execute(ctx: StrategyContext): Promise<StrategyResult> {
    const keywordLimit = ctx.intensity === 'lite' ? 6 : ctx.intensity === 'deep' ? 14 : 8;
    const keywords = ctx.keywords.slice(0, keywordLimit);
    const contextLines = ctx.intensity === 'lite' ? 1 : ctx.intensity === 'deep' ? 4 : 2;
    const maxResults = ctx.intensity === 'lite' ? 40 : ctx.intensity === 'deep' ? 120 : 80;
    const candidates: SliceCandidate[] = [];
    const warnings: string[] = [];

    if (keywords.length === 0) {
      warnings.push('Keyword strategy skipped: no usable keywords found.');
      return { candidates, warnings };
    }

    const matchByFile = await collectKeywordMatches(
      ctx.backend, keywords, ctx.request,
      { contextLines, maxResults }
    );

    for (const [path, matches] of matchByFile) {
      const fullPath = join(ctx.repoRoot, path);
      const content = await loadFileContent(fullPath);
      if (!content) continue;

      const lines = content.split('\n');
      const lineNumbers = matches.map((m) => m.line).filter(Boolean);
      const snippet = buildSnippet(path, lines, lineNumbers.slice(0, 6), contextLines);
      const tokens = estimateTokens(snippet);

      candidates.push({
        id: `keyword:${path}`,
        path,
        strategy: 'keyword' as const,
        representation: 'snippet' as const,
        score: scoreCandidate('keyword', matches.length, tokens, ctx.budgetTokens),
        tokens,
        reason: `Keyword hits: ${matches.length}`,
        source: 'search',
        content: snippet,
        alternates: [makeReferenceAlternate(path, 'keyword reference')],
      });
      ctx.matchedFiles.add(path);
    }

    return { candidates, warnings };
  },
});
