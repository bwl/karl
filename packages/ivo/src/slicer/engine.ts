/**
 * Slicer Engine — plan + assemble using pluggable strategies
 */

import type { IvoBackend } from '../backends/types.js';
import type { ContextFile, ContextResult } from '../types.js';
import { expandKeywords } from '../expand.js';
import { getStrategy } from './registry.js';
import type { StrategyContext, StrategySidecar } from './strategy.js';
import type {
  SliceAlternate,
  SliceCandidate,
  SliceIntensity,
  SlicePlan,
  SliceRequest,
  SliceResult,
  SliceStrategy,
  SliceTree,
} from './types.js';
import { estimateTokens, extractKeywords, STRATEGY_BUDGET_CAPS, STRATEGY_WEIGHTS } from './utils.js';

const DEFAULT_BUDGET = 32000;
const DEFAULT_WARNING = 0.75;
const UNBOUNDED = Number.POSITIVE_INFINITY;

const DEFAULT_STRATEGIES: Record<SliceIntensity, SliceStrategy[]> = {
  lite: ['inventory', 'skeleton', 'keyword', 'config'],
  standard: ['inventory', 'skeleton', 'keyword', 'symbols', 'config', 'diff', 'graph', 'semantic', 'forest'],
  deep: ['inventory', 'skeleton', 'keyword', 'symbols', 'config', 'diff', 'graph', 'semantic', 'ast', 'complexity', 'docs', 'forest'],
};

const DEFAULT_INTENSITY: SliceIntensity = 'deep';

const REPRESENTATION_RANK: Record<SliceCandidate['representation'], number> = {
  full: 3,
  snippet: 2,
  codemap: 1,
  reference: 0,
};

export const CANDIDATE_SORT = [
  'score_desc',
  'strategy_order',
  'representation_desc',
  'tokens_asc',
  'path_asc',
] as const;

function normalizeIntensity(intensity?: SliceIntensity): SliceIntensity {
  if (intensity === 'lite' || intensity === 'standard' || intensity === 'deep') return intensity;
  return DEFAULT_INTENSITY;
}

function resolveIntensity(
  strategy: SliceStrategy,
  request: SliceRequest,
  fallback: SliceIntensity
): SliceIntensity {
  const override = request.strategyIntensity?.[strategy];
  return normalizeIntensity(override ?? fallback);
}

// ============================================================================
// Candidate operations (merge, rank, cap, pick, upgrade)
// ============================================================================

function applyStrategyCaps(candidates: SliceCandidate[], request: SliceRequest): SliceCandidate[] {
  if (!request.strategyCaps) return candidates;

  const byStrategy = new Map<SliceStrategy, SliceCandidate[]>();
  for (const candidate of candidates) {
    const list = byStrategy.get(candidate.strategy) ?? [];
    list.push(candidate);
    byStrategy.set(candidate.strategy, list);
  }

  const capped: SliceCandidate[] = [];
  for (const [strategy, list] of byStrategy) {
    const caps = request.strategyCaps?.[strategy];
    if (!caps) { capped.push(...list); continue; }

    const maxItems = caps.maxItems ?? UNBOUNDED;
    let remainingTokens = caps.maxTokens ?? UNBOUNDED;
    const sorted = list
      .slice()
      .sort((a, b) => b.score - a.score || a.tokens - b.tokens || a.path.localeCompare(b.path));

    let count = 0;
    for (const candidate of sorted) {
      if (count >= maxItems) break;
      if (candidate.tokens > remainingTokens) continue;
      capped.push(candidate);
      remainingTokens -= candidate.tokens;
      count += 1;
    }
  }

  return capped;
}

export function rankCandidates(plan: SlicePlan): SliceCandidate[] {
  const order = new Map<string, number>();
  plan.request.strategies?.forEach((strategy, index) => {
    order.set(strategy, index);
  });
  order.set('explicit', -1);

  const strategyIndex = (strategy: SliceStrategy): number => {
    const value = order.get(strategy);
    return value === undefined ? 999 : value;
  };

  return plan.candidates
    .slice()
    .sort(
      (a, b) =>
        b.score - a.score ||
        strategyIndex(a.strategy) - strategyIndex(b.strategy) ||
        REPRESENTATION_RANK[b.representation] - REPRESENTATION_RANK[a.representation] ||
        a.tokens - b.tokens ||
        a.path.localeCompare(b.path)
    );
}

function mergeCandidates(candidates: SliceCandidate[]): SliceCandidate[] {
  const byKey = new Map<string, SliceCandidate>();

  for (const candidate of candidates) {
    const key = `${candidate.strategy}:${candidate.path}`;
    const existing = byKey.get(key);
    if (!existing) { byKey.set(key, candidate); continue; }

    const existingRank = REPRESENTATION_RANK[existing.representation];
    const nextRank = REPRESENTATION_RANK[candidate.representation];

    let chosen = existing;
    if (nextRank > existingRank || (nextRank === existingRank && candidate.score > existing.score)) {
      chosen = candidate;
    }

    const reasons = new Set([existing.reason, candidate.reason].filter(Boolean));
    chosen.reason = Array.from(reasons).join('; ');
    chosen.score = Math.max(existing.score, candidate.score);

    const sources = new Set([existing.source, candidate.source].filter(Boolean));
    chosen.source = Array.from(sources).join('; ');

    byKey.set(key, chosen);
  }

  return Array.from(byKey.values());
}

function pickCandidate(candidate: SliceCandidate, remaining: number): SliceCandidate | null {
  if (candidate.tokens <= remaining) return candidate;
  for (const alternate of candidate.alternates ?? []) {
    if (alternate.tokens <= remaining) {
      return {
        ...candidate,
        representation: alternate.representation,
        tokens: alternate.tokens,
        content: alternate.content,
        codemap: alternate.codemap,
      };
    }
  }
  return null;
}

function upgradeSelectedCandidates(selected: SliceCandidate[], remaining: number): number {
  const upgradeOrder = selected
    .slice()
    .sort(
      (a, b) =>
        REPRESENTATION_RANK[a.representation] - REPRESENTATION_RANK[b.representation] ||
        b.score - a.score ||
        a.tokens - b.tokens
    );

  for (const candidate of upgradeOrder) {
    const alternates = candidate.alternates ?? [];
    if (!alternates.length) continue;

    const better = alternates
      .filter((alt) => REPRESENTATION_RANK[alt.representation] > REPRESENTATION_RANK[candidate.representation])
      .sort(
        (a, b) =>
          REPRESENTATION_RANK[b.representation] - REPRESENTATION_RANK[a.representation] || b.tokens - a.tokens
      );

    for (const alt of better) {
      const delta = alt.tokens - candidate.tokens;
      if (delta <= 0 || delta > remaining) continue;
      candidate.representation = alt.representation;
      candidate.tokens = alt.tokens;
      candidate.content = alt.content;
      candidate.codemap = alt.codemap;
      remaining -= delta;
      break;
    }
  }

  return remaining;
}

function buildStrategyTotals(candidates: SliceCandidate[]): Record<string, { tokens: number; count: number }> {
  const totals: Record<string, { tokens: number; count: number }> = {};
  for (const candidate of candidates) {
    const entry = totals[candidate.strategy] ?? { tokens: 0, count: 0 };
    entry.tokens += candidate.tokens;
    entry.count += 1;
    totals[candidate.strategy] = entry;
  }
  return totals;
}

function representationToMode(representation: SliceCandidate['representation']): ContextFile['mode'] {
  switch (representation) {
    case 'full': return 'full';
    case 'codemap': return 'codemap';
    default: return 'slice';
  }
}

// ============================================================================
// SlicerEngine
// ============================================================================

export class SlicerEngine {
  private backend: IvoBackend;

  constructor(backend: IvoBackend) {
    this.backend = backend;
  }

  async plan(request: SliceRequest): Promise<SlicePlan> {
    const budgetTokens = request.budgetTokens || DEFAULT_BUDGET;
    const warningThreshold = request.warningThreshold ?? DEFAULT_WARNING;
    const intensity = normalizeIntensity(request.intensity);
    const strategies = (request.strategies?.length ? request.strategies : DEFAULT_STRATEGIES[intensity]).slice();

    const warnings: string[] = [];
    const candidates: SliceCandidate[] = [];
    const matchedFiles = new Set<string>();
    const sidecars = new Map<string, StrategySidecar>();

    // Expand keywords from task
    const rawKeywords = extractKeywords(request.task, 12);
    const keywords = await expandKeywords(rawKeywords, {
      maxKeywords: 20,
      repoRoot: request.repoRoot,
    });

    // Build shared strategy context
    const ctx: StrategyContext = {
      backend: this.backend,
      request,
      keywords,
      matchedFiles,
      repoRoot: request.repoRoot,
      budgetTokens,
      intensity,
    };

    // Run each strategy via registry
    for (const strategyName of strategies) {
      const plugin = getStrategy(strategyName);
      if (!plugin) {
        warnings.push(`Unknown strategy: ${strategyName}`);
        continue;
      }

      // Apply per-strategy intensity override
      const strategyIntensity = resolveIntensity(strategyName, request, intensity);
      ctx.intensity = strategyIntensity;

      try {
        if (!(await plugin.isAvailable(ctx))) {
          warnings.push(`${strategyName} not available`);
          continue;
        }

        const result = await plugin.execute(ctx);
        candidates.push(...result.candidates);
        if (result.warnings) warnings.push(...result.warnings);
        if (result.sidecar) sidecars.set(result.sidecar.key, result.sidecar);
      } catch (err) {
        warnings.push(`${strategyName} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Extract tree and forest from sidecars
    const treeSidecar = sidecars.get('tree');
    const forestSidecar = sidecars.get('forest');

    const tree: SliceTree | undefined = treeSidecar
      ? { content: treeSidecar.content, tokens: treeSidecar.tokens }
      : undefined;

    const forestData = forestSidecar
      ? { content: forestSidecar.content, tokens: forestSidecar.tokens }
      : undefined;

    // Also support includeTree flag even if inventory wasn't in strategies
    if (!tree && request.includeTree) {
      try {
        const treeContent = await this.backend.getTree({ maxDepth: 3 });
        const treeTokens = estimateTokens(treeContent);
        const fallbackTree = { content: treeContent, tokens: treeTokens };
        // Use fallback tree below
        const cappedCandidates = applyStrategyCaps(candidates, request);
        const merged = mergeCandidates(cappedCandidates);
        const strategyTotals = buildStrategyTotals(merged);
        const totalTokens = merged.reduce((sum, c) => sum + c.tokens, 0)
          + fallbackTree.tokens
          + (forestData?.tokens ?? 0);

        return {
          request: { ...request, budgetTokens, warningThreshold, intensity, strategies },
          candidates: merged,
          strategyTotals,
          warnings,
          tree: fallbackTree,
          forest: forestData,
          totalTokens,
        };
      } catch {
        warnings.push('includeTree failed: unable to build tree view.');
      }
    }

    const cappedCandidates = applyStrategyCaps(candidates, request);
    const merged = mergeCandidates(cappedCandidates);
    const strategyTotals = buildStrategyTotals(merged);
    const totalTokens = merged.reduce((sum, c) => sum + c.tokens, 0)
      + (tree?.tokens ?? 0)
      + (forestData?.tokens ?? 0);

    return {
      request: { ...request, budgetTokens, warningThreshold, intensity, strategies },
      candidates: merged,
      strategyTotals,
      warnings,
      tree,
      forest: forestData,
      totalTokens,
    };
  }

  async assemble(plan: SlicePlan, budgetOverride?: number): Promise<SliceResult> {
    const budgetTokens = budgetOverride ?? plan.request.budgetTokens ?? DEFAULT_BUDGET;
    let remaining = budgetTokens;
    const selected: SliceCandidate[] = [];
    let treeTokens = 0;

    if (plan.tree && plan.tree.tokens <= remaining) {
      treeTokens = plan.tree.tokens;
      remaining -= treeTokens;
    }

    let forestTokens = 0;
    if (plan.forest && plan.forest.tokens <= remaining) {
      forestTokens = plan.forest.tokens;
      remaining -= forestTokens;
    }

    const sorted = rankCandidates(plan);

    const strategyTokens: Record<string, number> = {};
    const selectedByPathRep = new Set<string>();
    const getStrategyBudget = (strategy: SliceStrategy): number => {
      const plugin = getStrategy(strategy);
      const cap = plugin?.defaultBudgetCap ?? STRATEGY_BUDGET_CAPS[strategy];
      return cap ? Math.floor(budgetTokens * cap) : budgetTokens;
    };

    for (const candidate of sorted) {
      const pathRepKey = `${candidate.path}:${candidate.representation}`;
      if (selectedByPathRep.has(pathRepKey)) continue;

      const strategyBudget = getStrategyBudget(candidate.strategy);
      const currentUsage = strategyTokens[candidate.strategy] ?? 0;
      const strategyRemaining = strategyBudget - currentUsage;
      const effectiveRemaining = Math.min(remaining, strategyRemaining);
      if (effectiveRemaining <= 0) continue;

      const picked = pickCandidate(candidate, effectiveRemaining);
      if (!picked) continue;

      selected.push(picked);
      selectedByPathRep.add(`${picked.path}:${picked.representation}`);
      remaining -= picked.tokens;
      strategyTokens[candidate.strategy] = currentUsage + picked.tokens;
      if (remaining <= 0) break;
    }

    if ((plan.request.intensity ?? 'standard') === 'deep' && remaining > 0) {
      remaining = upgradeSelectedCandidates(selected, remaining);
    }

    const files: ContextFile[] = selected.map((candidate) => ({
      path: candidate.path,
      tokens: candidate.tokens,
      mode: representationToMode(candidate.representation),
      content: candidate.representation === 'codemap' ? undefined : candidate.content,
      codemap: candidate.representation === 'codemap' ? candidate.codemap : undefined,
      relevance: Number(candidate.score.toFixed(2)),
      reason: candidate.reason,
      strategy: candidate.strategy,
    }));

    const strategyStats: Record<string, { count: number; tokens: number }> = {};
    for (const candidate of selected) {
      const stats = strategyStats[candidate.strategy] ?? { count: 0, tokens: 0 };
      stats.count++;
      stats.tokens += candidate.tokens;
      strategyStats[candidate.strategy] = stats;
    }
    if (plan.tree && treeTokens > 0) {
      const inv = strategyStats['inventory'] ?? { count: 0, tokens: 0 };
      inv.tokens += treeTokens;
      strategyStats['inventory'] = inv;
    }
    if (plan.forest && forestTokens > 0) {
      strategyStats['forest'] = { count: 0, tokens: forestTokens };
    }

    const totalTokens = budgetTokens - remaining;
    const context: ContextResult = {
      task: plan.request.task,
      files,
      totalTokens,
      budget: budgetTokens,
      strategies: strategyStats,
      tree: plan.tree && treeTokens > 0 ? plan.tree.content : undefined,
      forest: plan.forest && forestTokens > 0 ? plan.forest.content : undefined,
    };

    return { selected, totalTokens, budgetTokens, context };
  }
}

export function createSlicerEngine(backend: IvoBackend): SlicerEngine {
  return new SlicerEngine(backend);
}
