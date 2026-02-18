/**
 * Forest Strategy — external knowledge graph via forest CLI (uses sidecar)
 */

import type { StrategyPlugin, StrategyContext, StrategyResult } from '../strategy.js';
import { detectProjectName, estimateTokens, exec, STRATEGY_BUDGET_CAPS } from '../utils.js';

export default (): StrategyPlugin => ({
  name: 'forest',
  defaultWeight: 0.70,
  defaultBudgetCap: 0.25,

  async isAvailable(): Promise<boolean> {
    const result = await exec('which', ['forest']);
    return result.exitCode === 0;
  },

  async execute(ctx: StrategyContext): Promise<StrategyResult> {
    const warnings: string[] = [];
    const budgetSlice = Math.floor(ctx.budgetTokens * (STRATEGY_BUDGET_CAPS['forest'] ?? 0.25));

    if (budgetSlice < 500) {
      warnings.push('Forest strategy skipped: budget slice too small (< 500 tokens).');
      return { candidates: [], warnings };
    }

    const projectName = await detectProjectName(ctx.repoRoot);
    if (!projectName) {
      warnings.push('Forest strategy skipped: could not detect project name.');
      return { candidates: [], warnings };
    }

    const keywords = ctx.keywords.slice(0, 10);
    const forestArgs = [
      'context',
      '--tag', `project:${projectName}`,
      '--query', keywords.join(', '),
      '--budget', String(budgetSlice),
    ];
    const forestResult = await exec('forest', forestArgs);

    if (forestResult.exitCode !== 0 || !forestResult.stdout.trim()) {
      warnings.push(`Forest strategy skipped: ${forestResult.stderr.trim() || 'no output from forest CLI'}.`);
      return { candidates: [], warnings };
    }

    const forestTokens = estimateTokens(forestResult.stdout);
    if (forestTokens < 100) {
      warnings.push('Forest strategy skipped: output too small (< 100 tokens).');
      return { candidates: [], warnings };
    }

    return {
      candidates: [],
      warnings,
      sidecar: {
        key: 'forest',
        content: forestResult.stdout,
        tokens: forestTokens,
      },
    };
  },
});
