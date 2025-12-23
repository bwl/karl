import { completeSimple, getModel, setApiKey } from '@mariozechner/pi-ai';
import type { AssistantMessage, Model } from '@mariozechner/pi-ai';
import { loadKarlContext, type ProviderConfig, type ResolvedModel } from '../karl/bridge.js';
import type { SliceIntensity, SlicePlan, SliceRequest, SliceStrategy, SliceStrategyCaps } from './types.js';

const AVAILABLE_STRATEGIES: SliceStrategy[] = [
  'inventory',
  'keyword',
  'symbols',
  'config',
  'diff',
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
  stackName: string;
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
  const { stackName, stackOptions, systemPrompt, resolvedModel, apiKey } = await loadKarlContext(cwd);
  const prompt = buildSuggestionPrompt(request, options, {
    stackName,
    systemPrompt,
  });

  const model = buildModel(
    resolvedModel.model,
    resolvedModel.providerKey,
    resolvedModel.providerConfig,
    apiKey,
    resolvedModel.maxTokens,
    resolvedModel.contextLength
  );

  const response = await completeSimple(model, {
    systemPrompt: SUGGESTION_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: prompt,
        timestamp: Date.now(),
      },
    ],
  }, {
    temperature: stackOptions.temperature ?? 0.2,
    maxTokens: options.maxTokens ?? stackOptions.maxTokens ?? DEFAULT_SUGGEST_TOKENS,
  });

  const raw = extractAssistantText(response);
  const parsed = parseSuggestionJson(raw);
  const update = normalizeSuggestion(parsed, options.strategiesLocked ?? false);
  const note = typeof parsed?.note === 'string' ? parsed.note.trim() : undefined;

  if (Object.keys(update).length === 0) {
    throw new Error('Suggestion returned no usable settings.');
  }

  return {
    update,
    note,
    stackName,
    raw,
  };
}

type BuildModelInput = Pick<ResolvedModel, 'model' | 'providerKey' | 'providerConfig' | 'maxTokens' | 'contextLength'>;

function mapToPiAiProvider(providerKey: string): string {
  const mapping: Record<string, string> = {
    'claude-pro-max': 'anthropic',
  };
  return mapping[providerKey] ?? providerKey;
}

function buildModel(
  modelId: BuildModelInput['model'],
  providerKey: BuildModelInput['providerKey'],
  providerConfig: ProviderConfig,
  apiKey: string,
  maxTokens?: BuildModelInput['maxTokens'],
  contextLength?: BuildModelInput['contextLength']
): Model<any> {
  const piProvider = mapToPiAiProvider(providerKey);
  setApiKey(piProvider, apiKey);
  const baseModel = getModel(piProvider as any, modelId as any);
  const api = baseModel?.api ?? (piProvider === 'anthropic' ? 'anthropic-messages' : 'openai-completions');
  const baseUrl = baseModel?.baseUrl ?? (providerConfig.baseUrl as string | undefined);

  if (!baseUrl) {
    throw new Error(`Provider "${providerKey}" is missing a baseUrl for LLM suggestions.`);
  }

  return {
    id: baseModel?.id ?? modelId,
    name: baseModel?.name ?? modelId,
    api,
    provider: baseModel?.provider ?? piProvider,
    baseUrl,
    reasoning: baseModel?.reasoning ?? false,
    input: baseModel?.input ?? ['text'],
    cost: baseModel?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: baseModel?.contextWindow ?? contextLength ?? 128000,
    maxTokens: baseModel?.maxTokens ?? maxTokens ?? 8192,
    headers: baseModel?.headers,
    compat: baseModel?.compat,
  };
}

function buildSuggestionPrompt(
  request: SliceRequest,
  options: SuggestBucketOptions,
  ctx: { stackName: string; systemPrompt: string }
): string {
  const trimmedPrompt = ctx.systemPrompt ? truncate(ctx.systemPrompt, MAX_SYSTEM_PROMPT_CHARS) : '';
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
    karlStack: ctx.stackName,
    karlSystemPrompt: trimmedPrompt,
    karlTask: request.task,
    currentConfig: current,
    planSummary,
    constraints: {
      strategiesLocked: options.strategiesLocked ?? false,
      availableStrategies: AVAILABLE_STRATEGIES,
      intensities: ['lite', 'standard', 'deep'],
    },
  };

  return [
    'Given the Karl request and the current Ivo bucket config, return JSON with suggested settings.',
    'Only include fields you want to change.',
    'Allowed fields: intensity, strategies, strategyIntensity, strategyCaps, includeTree, includePreviousResponse, include, exclude, note.',
    'Use arrays for strategies/include/exclude. Use strategyCaps as { strategy: { maxItems, maxTokens } }.',
    'Return JSON only.',
    '',
    JSON.stringify(payload, null, 2),
  ].join('\n');
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3)}...`;
}

function extractAssistantText(message: AssistantMessage): string {
  const parts: string[] = [];
  for (const block of message.content || []) {
    if (block.type === 'text') {
      parts.push(block.text);
    }
  }
  return parts.join('\n').trim();
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
