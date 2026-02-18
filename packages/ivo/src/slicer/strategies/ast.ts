/**
 * AST Strategy — codemap view for keyword-matched files
 */

import { join } from 'path';
import { detectLanguage, extractCodemap, formatCodemapCompact } from '../../codemap/index.js';
import type { StrategyPlugin, StrategyContext, StrategyResult } from '../strategy.js';
import type { SliceCandidate } from '../types.js';
import { collectKeywordMatches, estimateTokens, makeReferenceAlternate, scoreCandidate } from '../utils.js';

export default (): StrategyPlugin => ({
  name: 'ast',
  defaultWeight: 0.50,

  async isAvailable() { return true; },

  async execute(ctx: StrategyContext): Promise<StrategyResult> {
    const astLimit = ctx.intensity === 'lite' ? 6 : ctx.intensity === 'deep' ? 24 : 12;
    const keywords = ctx.keywords.slice(0, 10);
    const candidates: SliceCandidate[] = [];
    const warnings: string[] = [];

    if (keywords.length === 0) {
      warnings.push('AST strategy skipped: no usable keywords found.');
      return { candidates, warnings };
    }

    const matchByFile = await collectKeywordMatches(
      ctx.backend, keywords, ctx.request,
      { contextLines: 0, maxResults: astLimit * 10 }
    );

    for (const path of Array.from(matchByFile.keys()).slice(0, astLimit)) {
      const fullPath = join(ctx.repoRoot, path);
      const language = detectLanguage(path);
      if (!language) continue;

      const codemap = await extractCodemap(fullPath);
      if (!codemap) continue;

      const compact = formatCodemapCompact(codemap);
      const tokens = estimateTokens(compact);

      candidates.push({
        id: `ast:${path}`,
        path,
        strategy: 'ast' as const,
        representation: 'codemap' as const,
        score: scoreCandidate('ast', matchByFile.get(path)?.length ?? 1, tokens, ctx.budgetTokens),
        tokens,
        reason: 'AST view for keyword hits',
        source: 'codemap',
        codemap: compact,
        alternates: [makeReferenceAlternate(path, 'ast reference')],
      });
      ctx.matchedFiles.add(path);
    }

    return { candidates, warnings };
  },
});
