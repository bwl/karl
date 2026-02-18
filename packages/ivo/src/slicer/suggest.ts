import { resolveLlmConfig, chatComplete } from '../llm.js';
import { loadConfig } from '../config.js';
import type { SliceIntensity, SlicePlan, SliceRequest, SliceStrategy, SliceStrategyCaps } from './types.js';

const AVAILABLE_STRATEGIES: SliceStrategy[] = [
  'inventory',
  'keyword',
  'symbols',
  'config',
  'diff',
  'graph',
  'ast',
  'complexity',
  'docs',
];

const SUGGESTION_SYSTEM_PROMPT = `You are Ivo, a context slicing planner.
Return only a JSON object with suggested bucket settings.
You may suggest includePreviousResponse when prior run history would help.
Do not include markdown, commentary, or extra keys.`;

const MAX_SYSTEM_PROMPT_CHARS = 4000;
const DEFAULT_SUGGEST_TOKENS = 1200;

export interface SuggestBucketOptions {
  plan?: SlicePlan;
  strategiesLocked?: boolean;
  maxTokens?: number;
  includePreviousResponse?: boolean;
}

export interface SuggestBucketResult {
  update: BucketSuggestionUpdate;
  note?: string;
  raw: string;
}

export type BucketSuggestionUpdate = Partial<SliceRequest> & {
  includePreviousResponse?: boolean;
};

export async function suggestBucketConfig(
  request: SliceRequest,
  options: SuggestBucketOptions = {}
): Promise<SuggestBucketResult> {
  if (!request.task?.trim()) {
    throw new Error('Task is required for suggestions.');
  }

  const cwd = request.repoRoot || process.cwd();
  const config = await loadConfig(cwd);
  const llm = resolveLlmConfig(config);
  if (!llm) {
    throw new Error('No LLM configured. Run `ivo setup` or set IVO_LLM_ENDPOINT.');
  }

  const prompt = buildSuggestionPrompt(request, options);

  const raw = await chatComplete(llm, [
    { role: 'system', content: SUGGESTION_SYSTEM_PROMPT },
    { role: 'user', content: prompt },
  ], {
    temperature: 0.2,
    maxTokens: options.maxTokens ?? DEFAULT_SUGGEST_TOKENS,
  });

  const parsed = parseSuggestionJson(raw);
  const update = normalizeSuggestion(parsed, options.strategiesLocked ?? false);
  const note = typeof parsed?.note === 'string' ? parsed.note.trim() : undefined;

  if (Object.keys(update).length === 0) {
    throw new Error('Suggestion returned no usable settings.');
  }

  return { update, note, raw };
}

function buildSuggestionPrompt(
  request: SliceRequest,
  options: SuggestBucketOptions
): string {
  const current = {
    budgetTokens: request.budgetTokens,
    intensity: request.intensity ?? 'standard',
    strategies: request.strategies ?? [],
    includeTree: request.includeTree ?? false,
    includePreviousResponse: options.includePreviousResponse ?? false,
    strategyCaps: request.strategyCaps ?? {},
    strategyIntensity: request.strategyIntensity ?? {},
    include: request.include ?? [],
    exclude: request.exclude ?? [],
  };

  const planSummary = options.plan
    ? {
        totalTokens: options.plan.totalTokens,
        warnings: options.plan.warnings,
        strategyTotals: options.plan.strategyTotals,
        treeTokens: options.plan.tree?.tokens ?? 0,
      }
    : undefined;

  const payload = {
    task: request.task,
    currentConfig: current,
    planSummary,
    constraints: {
      strategiesLocked: options.strategiesLocked ?? false,
      availableStrategies: AVAILABLE_STRATEGIES,
      intensities: ['lite', 'standard', 'deep'],
    },
  };

  return [
    'Given the task and the current Ivo bucket config, return JSON with suggested settings.',
    'Only include fields you want to change.',
    'Allowed fields: intensity, strategies, strategyIntensity, strategyCaps, includeTree, includePreviousResponse, include, exclude, note.',
    'Use arrays for strategies/include/exclude. Use strategyCaps as { strategy: { maxItems, maxTokens } }.',
    'Return JSON only.',
    '',
    JSON.stringify(payload, null, 2),
  ].join('\n');
}

function parseSuggestionJson(raw: string): Record<string, unknown> {
  if (!raw) {
    throw new Error('Empty response from suggestion model.');
  }

  const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : extractJsonBlock(raw);
  if (!candidate) {
    throw new Error('No JSON object found in suggestion response.');
  }

  try {
    return JSON.parse(candidate) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Failed to parse suggestion JSON: ${(error as Error).message}`);
  }
}

function extractJsonBlock(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return text.slice(start, end + 1);
}

function normalizeSuggestion(
  parsed: Record<string, unknown>,
  strategiesLocked: boolean
): BucketSuggestionUpdate {
  const update: BucketSuggestionUpdate = {};

  if ('intensity' in parsed) {
    const intensity = String(parsed.intensity);
    if (intensity === 'lite' || intensity === 'standard' || intensity === 'deep') {
      update.intensity = intensity as SliceIntensity;
    }
  }

  if ('strategies' in parsed && !strategiesLocked) {
    const list = normalizeStringArray(parsed.strategies);
    const filtered = list.filter((strategy) => AVAILABLE_STRATEGIES.includes(strategy as SliceStrategy));
    if (filtered.length) {
      update.strategies = filtered as SliceStrategy[];
    }
  }

  if ('includeTree' in parsed) {
    update.includeTree = Boolean(parsed.includeTree);
  }

  if ('includePreviousResponse' in parsed) {
    update.includePreviousResponse = Boolean(parsed.includePreviousResponse);
  }

  if ('include' in parsed) {
    update.include = normalizeStringArray(parsed.include);
  }

  if ('exclude' in parsed) {
    update.exclude = normalizeStringArray(parsed.exclude);
  }

  if ('strategyIntensity' in parsed) {
    update.strategyIntensity = parseStrategyIntensity(parsed.strategyIntensity);
  }

  if ('strategyCaps' in parsed) {
    update.strategyCaps = parseStrategyCaps(parsed.strategyCaps);
  }

  return Object.fromEntries(Object.entries(update).filter(([, value]) => value !== undefined));
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function parseStrategyIntensity(
  value: unknown
): Partial<Record<SliceStrategy, SliceIntensity>> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const result: Partial<Record<SliceStrategy, SliceIntensity>> = {};

  for (const [strategy, intensityRaw] of Object.entries(value as Record<string, unknown>)) {
    if (!AVAILABLE_STRATEGIES.includes(strategy as SliceStrategy)) continue;
    const intensity = String(intensityRaw);
    if (intensity !== 'lite' && intensity !== 'standard' && intensity !== 'deep') continue;
    result[strategy as SliceStrategy] = intensity as SliceIntensity;
  }

  return Object.keys(result).length ? result : undefined;
}

function parseStrategyCaps(
  value: unknown
): Partial<Record<SliceStrategy, SliceStrategyCaps>> | undefined {
  if (value === null) return {};
  if (!value || typeof value !== 'object') return undefined;
  const result: Partial<Record<SliceStrategy, SliceStrategyCaps>> = {};

  for (const [strategy, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!AVAILABLE_STRATEGIES.includes(strategy as SliceStrategy)) continue;
    if (entry && typeof entry === 'object') {
      const maxItems = toPositiveNumber((entry as Record<string, unknown>).maxItems);
      const maxTokens = toPositiveNumber((entry as Record<string, unknown>).maxTokens);
      if (maxItems || maxTokens) {
        result[strategy as SliceStrategy] = {
          maxItems: maxItems || undefined,
          maxTokens: maxTokens || undefined,
        };
      }
    } else {
      const numeric = toPositiveNumber(entry);
      if (numeric) {
        result[strategy as SliceStrategy] = {
          maxTokens: numeric,
        };
      }
    }
  }

  return Object.keys(result).length ? result : {};
}

function toPositiveNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : parseInt(String(value), 10);
  if (Number.isNaN(parsed) || parsed <= 0) return null;
  return parsed;
}
