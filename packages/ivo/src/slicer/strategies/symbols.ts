/**
 * Symbols Strategy — extract codemaps for files matched by other strategies
 */

import { formatCodemapCompact } from '../../codemap/index.js';
import type { StrategyPlugin, StrategyContext, StrategyResult } from '../strategy.js';
import type { SliceCandidate } from '../types.js';
import { estimateTokens, isPathIncluded, makeReferenceAlternate, scoreCandidate } from '../utils.js';

export default (): StrategyPlugin => ({
  name: 'symbols',
  defaultWeight: 0.55,

  async isAvailable() { return true; },

  async execute(ctx: StrategyContext): Promise<StrategyResult> {
    const maxFiles = ctx.intensity === 'lite' ? 6 : ctx.intensity === 'deep' ? 24 : 14;
    const symbolTargets = Array.from(ctx.matchedFiles).slice(0, maxFiles);
    const candidates: SliceCandidate[] = [];
    const warnings: string[] = [];

    if (symbolTargets.length === 0) {
      warnings.push('Symbols strategy skipped: no candidate files to extract codemaps.');
      return { candidates, warnings };
    }

    const structure = await ctx.backend.getStructure(symbolTargets, { scope: 'paths' });
    for (const codemap of structure.codemaps) {
      if (!isPathIncluded(codemap.path, ctx.request)) continue;
      const compact = formatCodemapCompact(codemap);
      const tokens = estimateTokens(compact);

      candidates.push({
        id: `symbols:${codemap.path}`,
        path: codemap.path,
        strategy: 'symbols' as const,
        representation: 'codemap' as const,
        score: scoreCandidate('symbols', 1, tokens, ctx.budgetTokens),
        tokens,
        reason: 'Codemap for referenced file',
        source: 'codemap',
        codemap: compact,
        alternates: [makeReferenceAlternate(codemap.path, 'symbols reference')],
      });
    }

    return { candidates, warnings };
  },
});
