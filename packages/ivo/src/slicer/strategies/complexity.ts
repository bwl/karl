/**
 * Complexity Strategy — include large code files as codemaps
 */

import { stat } from 'fs/promises';
import { join } from 'path';
import { detectLanguage, extractCodemap, formatCodemapCompact } from '../../codemap/index.js';
import type { StrategyPlugin, StrategyContext, StrategyResult } from '../strategy.js';
import type { SliceAlternate } from '../types.js';
import { estimateTokens, isCodePath, isPathIncluded, listRepoFiles, loadFileContent, makeReferenceAlternate, scoreCandidate } from '../utils.js';

export default (): StrategyPlugin => ({
  name: 'complexity',
  defaultWeight: 0.40,

  async isAvailable() { return true; },

  async execute(ctx: StrategyContext): Promise<StrategyResult> {
    const limit = ctx.intensity === 'lite' ? 10 : ctx.intensity === 'deep' ? 40 : 20;
    const maxFullTokens = ctx.intensity === 'deep' ? 4000 : 2500;
    const files = await listRepoFiles(ctx.repoRoot);
    const candidates = [];

    const sizeEntries: Array<{ path: string; size: number }> = [];
    for (const path of files) {
      if (!isPathIncluded(path, ctx.request)) continue;
      if (!isCodePath(path)) continue;
      try {
        const stats = await stat(join(ctx.repoRoot, path));
        sizeEntries.push({ path, size: stats.size });
      } catch { /* skip */ }
    }

    sizeEntries.sort((a, b) => b.size - a.size);

    for (const entry of sizeEntries.slice(0, limit)) {
      const fullPath = join(ctx.repoRoot, entry.path);
      const language = detectLanguage(entry.path);

      if (language) {
        const content = await loadFileContent(fullPath);
        if (!content) continue;

        const fullTokens = estimateTokens(content);
        const codemap = await extractCodemap(fullPath, content);
        if (!codemap) continue;

        const compact = formatCodemapCompact(codemap);
        const tokens = estimateTokens(compact);
        const alternates: SliceAlternate[] = [makeReferenceAlternate(entry.path, 'complexity reference')];
        if (fullTokens <= maxFullTokens) {
          alternates.unshift({ representation: 'full', tokens: fullTokens, content });
        }

        candidates.push({
          id: `complexity:${entry.path}`,
          path: entry.path,
          strategy: 'complexity' as const,
          representation: 'codemap' as const,
          score: scoreCandidate('complexity', 1, tokens, ctx.budgetTokens),
          tokens,
          reason: `Large file (${Math.round(entry.size / 1024)}kb)`,
          source: 'size scan',
          codemap: compact,
          alternates,
        });
      } else {
        const reference = makeReferenceAlternate(entry.path, 'complexity reference');
        candidates.push({
          id: `complexity:${entry.path}`,
          path: entry.path,
          strategy: 'complexity' as const,
          representation: 'reference' as const,
          score: scoreCandidate('complexity', 1, reference.tokens, ctx.budgetTokens),
          tokens: reference.tokens,
          reason: `Large file (${Math.round(entry.size / 1024)}kb)`,
          source: 'size scan',
        });
      }
    }

    return { candidates };
  },
});
