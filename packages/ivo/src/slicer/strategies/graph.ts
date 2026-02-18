/**
 * Graph Strategy — BFS import graph walk from seed files
 */

import { join } from 'path';
import { detectLanguage, extractCodemap, formatCodemapCompact } from '../../codemap/index.js';
import { buildImportGraph, bfsWalk } from '../../graph/index.js';
import type { StrategyPlugin, StrategyContext, StrategyResult } from '../strategy.js';
import type { SliceCandidate } from '../types.js';
import {
  estimateTokens, isCodePath, isPathIncluded, listRepoFiles,
  makeReferenceAlternate, STRATEGY_WEIGHTS,
} from '../utils.js';

export default (): StrategyPlugin => ({
  name: 'graph',
  defaultWeight: 0.50,
  defaultBudgetCap: 0.15,

  async isAvailable() { return true; },

  async execute(ctx: StrategyContext): Promise<StrategyResult> {
    const maxGraphFiles = ctx.intensity === 'lite' ? 6 : ctx.intensity === 'deep' ? 20 : 12;
    const graphDepth = ctx.intensity === 'lite' ? 1 : ctx.intensity === 'deep' ? 3 : 2;
    const seedFiles = Array.from(ctx.matchedFiles);
    const candidates: SliceCandidate[] = [];
    const warnings: string[] = [];

    if (seedFiles.length === 0) {
      warnings.push('Graph strategy skipped: no seed files from prior strategies.');
      return { candidates, warnings };
    }

    const codeFiles = (await listRepoFiles(ctx.repoRoot)).filter(isCodePath);

    // Performance guard: limit to adjacent directories for large repos
    let filesToAnalyze = codeFiles;
    if (codeFiles.length > 500) {
      const seedDirs = new Set(seedFiles.map((f) => f.split('/').slice(0, -1).join('/')));
      const adjacentDirs = new Set<string>();
      for (const dir of seedDirs) {
        adjacentDirs.add(dir);
        const parent = dir.split('/').slice(0, -1).join('/');
        if (parent) adjacentDirs.add(parent);
      }
      filesToAnalyze = codeFiles.filter((f) => {
        const dir = f.split('/').slice(0, -1).join('/');
        return adjacentDirs.has(dir);
      });
    }

    const structure = await ctx.backend.getStructure(filesToAnalyze, { scope: 'paths' });
    const graph = buildImportGraph(structure.codemaps, ctx.repoRoot);
    const discovered = bfsWalk(graph, seedFiles, graphDepth);

    let graphCount = 0;
    for (const [path, depth] of discovered) {
      if (depth === 0) continue;
      if (ctx.matchedFiles.has(path)) continue;
      if (!isPathIncluded(path, ctx.request)) continue;
      if (graphCount >= maxGraphFiles) break;

      const fullPath = join(ctx.repoRoot, path);
      const language = detectLanguage(path);
      if (!language) continue;

      const codemap = await extractCodemap(fullPath);
      if (!codemap) continue;

      const compact = formatCodemapCompact(codemap);
      const tokens = estimateTokens(compact);
      const depthPenalty = depth * 0.08;
      const score = Math.max(0.05, (STRATEGY_WEIGHTS['graph'] ?? 0.50) - depthPenalty);

      candidates.push({
        id: `graph:${path}`,
        path,
        strategy: 'graph' as const,
        representation: 'codemap' as const,
        score,
        tokens,
        reason: `Import graph: depth ${depth} from keyword matches`,
        source: 'import graph',
        codemap: compact,
        alternates: [makeReferenceAlternate(path, 'graph reference')],
      });
      ctx.matchedFiles.add(path);
      graphCount++;
    }

    return { candidates, warnings };
  },
});
