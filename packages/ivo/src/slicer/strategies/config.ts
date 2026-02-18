/**
 * Config Strategy — discover and include project configuration files
 */

import { existsSync } from 'fs';
import { join } from 'path';
import type { StrategyPlugin, StrategyContext, StrategyResult } from '../strategy.js';
import { CONFIG_FILES, estimateTokens, isPathIncluded, loadFileContent, makeReferenceAlternate, scoreCandidate } from '../utils.js';

export default (): StrategyPlugin => ({
  name: 'config',
  defaultWeight: 0.45,

  async isAvailable() { return true; },

  async execute(ctx: StrategyContext): Promise<StrategyResult> {
    const maxConfigTokens = ctx.intensity === 'lite' ? 800 : ctx.intensity === 'deep' ? 2400 : 1400;
    const candidates = [];

    for (const path of CONFIG_FILES) {
      if (!isPathIncluded(path, ctx.request)) continue;
      const fullPath = join(ctx.repoRoot, path);
      if (!existsSync(fullPath)) continue;

      const content = await loadFileContent(fullPath);
      if (!content) continue;

      const tokens = estimateTokens(content);
      let representation: 'full' | 'snippet' = 'full';
      let body = content;

      if (tokens > maxConfigTokens) {
        const lines = content.split('\n');
        body = lines.slice(0, 200).join('\n');
        representation = 'snippet';
      }

      candidates.push({
        id: `config:${path}`,
        path,
        strategy: 'config' as const,
        representation,
        score: scoreCandidate('config', 1, tokens, ctx.budgetTokens),
        tokens: estimateTokens(body),
        reason: 'Configuration file',
        source: 'config scan',
        content: body,
        alternates: [makeReferenceAlternate(path, 'config reference')],
      });
    }

    return { candidates };
  },
});
