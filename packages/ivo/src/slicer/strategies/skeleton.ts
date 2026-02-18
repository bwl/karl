/**
 * Skeleton Strategy — entry points and structural files, represented as codemaps
 */

import { join } from 'path';
import { detectLanguage, extractCodemap, formatCodemapCompact } from '../../codemap/index.js';
import type { StrategyPlugin, StrategyContext, StrategyResult } from '../strategy.js';
import type { SliceAlternate } from '../types.js';
import {
  estimateTokens, isPathIncluded, listRepoFiles, loadFileContent,
  makeReferenceAlternate, scoreCandidate, SKELETON_PATTERNS, SKELETON_DIRS,
} from '../utils.js';

export default (): StrategyPlugin => ({
  name: 'skeleton',
  defaultWeight: 0.90,

  async isAvailable() { return true; },

  async execute(ctx: StrategyContext): Promise<StrategyResult> {
    const maxFiles = ctx.intensity === 'lite' ? 8 : ctx.intensity === 'deep' ? 30 : 16;
    const allFiles = await listRepoFiles(ctx.repoRoot);
    const candidates = [];

    const skeletonFiles: string[] = [];
    for (const file of allFiles) {
      if (!isPathIncluded(file, ctx.request)) continue;
      const base = file.split('/').pop() || '';
      const inPriorityDir = SKELETON_DIRS.some(dir => file.includes(dir));
      if (SKELETON_PATTERNS.includes(base) && inPriorityDir) {
        skeletonFiles.push(file);
      }
    }

    for (const path of skeletonFiles.slice(0, maxFiles)) {
      const fullPath = join(ctx.repoRoot, path);
      const language = detectLanguage(path);
      if (!language) continue;

      const content = await loadFileContent(fullPath);
      if (!content) continue;

      const codemap = await extractCodemap(fullPath, content);
      if (!codemap) continue;

      const compact = formatCodemapCompact(codemap);
      const tokens = estimateTokens(compact);
      const fullTokens = estimateTokens(content);

      const alternates: SliceAlternate[] = [makeReferenceAlternate(path, 'skeleton reference')];
      if (fullTokens <= 2000) {
        alternates.unshift({ representation: 'full', tokens: fullTokens, content });
      }

      candidates.push({
        id: `skeleton:${path}`,
        path,
        strategy: 'skeleton' as const,
        representation: 'codemap' as const,
        score: scoreCandidate('skeleton', 1, tokens, ctx.budgetTokens),
        tokens,
        reason: 'Entry point / structural file',
        source: 'skeleton scan',
        codemap: compact,
        alternates,
      });
      ctx.matchedFiles.add(path);
    }

    return { candidates };
  },
});
