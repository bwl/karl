/**
 * Semantic Strategy — embedding-based conceptual neighbors
 */

import { join } from 'path';
import { detectLanguage, extractCodemap, formatCodemapCompact } from '../../codemap/index.js';
import { EmbeddingIndex } from '../../embeddings/index.js';
import type { StrategyPlugin, StrategyContext, StrategyResult } from '../strategy.js';
import type { SliceCandidate } from '../types.js';
import { estimateTokens, isPathIncluded, makeReferenceAlternate, STRATEGY_WEIGHTS } from '../utils.js';

export default (): StrategyPlugin => ({
  name: 'semantic',
  defaultWeight: 0.55,
  defaultBudgetCap: 0.15,

  async isAvailable(ctx: StrategyContext): Promise<boolean> {
    const index = await EmbeddingIndex.load(ctx.repoRoot);
    return !!index && index.size > 0;
  },

  async execute(ctx: StrategyContext): Promise<StrategyResult> {
    const maxFiles = ctx.intensity === 'lite' ? 6 : ctx.intensity === 'deep' ? 16 : 10;
    const seedFiles = Array.from(ctx.matchedFiles);
    const candidates: SliceCandidate[] = [];
    const warnings: string[] = [];

    if (seedFiles.length === 0) {
      warnings.push('Semantic strategy skipped: no seed files.');
      return { candidates, warnings };
    }

    const embeddingIndex = await EmbeddingIndex.load(ctx.repoRoot);
    if (!embeddingIndex || embeddingIndex.size === 0) {
      warnings.push('Semantic strategy skipped: no embedding index (run ivo index).');
      return { candidates, warnings };
    }

    const centroid = embeddingIndex.centroid(seedFiles);
    if (!centroid) return { candidates, warnings };

    const neighbors = embeddingIndex.nearest(centroid, maxFiles * 2, ctx.matchedFiles)
      .filter((n) => isPathIncluded(n.path, ctx.request))
      .slice(0, maxFiles);

    for (const neighbor of neighbors) {
      const fullPath = join(ctx.repoRoot, neighbor.path);
      const language = detectLanguage(neighbor.path);
      if (!language) continue;

      const codemap = await extractCodemap(fullPath);
      if (!codemap) continue;

      const compact = formatCodemapCompact(codemap);
      const tokens = estimateTokens(compact);
      const score = (STRATEGY_WEIGHTS['semantic'] ?? 0.55) * neighbor.similarity;

      candidates.push({
        id: `semantic:${neighbor.path}`,
        path: neighbor.path,
        strategy: 'semantic' as const,
        representation: 'codemap' as const,
        score,
        tokens,
        reason: `Semantic neighbor (similarity: ${neighbor.similarity.toFixed(2)})`,
        source: 'embedding index',
        codemap: compact,
        alternates: [makeReferenceAlternate(neighbor.path, 'semantic reference')],
      });
      ctx.matchedFiles.add(neighbor.path);
    }

    return { candidates, warnings };
  },
});
