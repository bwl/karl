/**
 * Inventory Strategy — file tree overview (uses sidecar)
 */

import type { StrategyPlugin, StrategyContext, StrategyResult } from '../strategy.js';
import { estimateTokens } from '../utils.js';

export default (): StrategyPlugin => ({
  name: 'inventory',
  defaultWeight: 0.20,

  async isAvailable() { return true; },

  async execute(ctx: StrategyContext): Promise<StrategyResult> {
    const maxDepth = ctx.intensity === 'lite' ? 2 : ctx.intensity === 'deep' ? 4 : 3;
    const warnings: string[] = [];

    try {
      const content = await ctx.backend.getTree({ maxDepth });
      const tokens = estimateTokens(content);

      return {
        candidates: [],
        warnings,
        sidecar: {
          key: 'tree',
          content,
          tokens,
        },
      };
    } catch {
      warnings.push('Inventory strategy failed: unable to build tree view.');
      return { candidates: [], warnings };
    }
  },
});
