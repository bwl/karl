/**
 * Model Registry - Unified model discovery via OpenRouter
 *
 * Syncs models from OpenRouter API and caches locally.
 * Provides filtering and provider-specific model ID mapping.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const REGISTRY_PATH = join(homedir(), '.config', 'karl', 'registry.json');
const OPENROUTER_API = 'https://openrouter.ai/api/v1/models';
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * OpenRouter model data structure
 */
export interface OpenRouterModel {
  id: string;
  canonical_slug: string;
  name: string;
  description: string;
  context_length: number;
  created: number;
  architecture: {
    modality: string;
    input_modalities: string[];
    output_modalities: string[];
    tokenizer: string;
  };
  pricing: {
    prompt: string;
    completion: string;
  };
  top_provider: {
    context_length: number;
    max_completion_tokens: number | null;
  };
}

/**
 * Cached registry structure
 */
export interface ModelRegistry {
  lastSync: number;
  models: OpenRouterModel[];
}

/**
 * Filter options for getModels()
 */
export interface ModelFilter {
  provider?: string;    // Filter by provider prefix (e.g., "anthropic", "openai")
  tokenizer?: string;   // Filter by tokenizer (e.g., "Claude", "GPT")
  search?: string;      // Fuzzy search in name/description
}

/**
 * Mapping from OpenRouter model IDs to Anthropic API model IDs
 * Updated manually when new models are released
 */
const ANTHROPIC_MODEL_MAP: Record<string, string> = {
  // Claude 4.5 series
  'anthropic/claude-opus-4.5': 'claude-opus-4-5-20251101',
  'anthropic/claude-sonnet-4.5': 'claude-sonnet-4-5-20250929',
  'anthropic/claude-haiku-4.5': 'claude-haiku-4-5-20251001',
  // Claude 4.1 series
  'anthropic/claude-opus-4.1': 'claude-opus-4-1-20250805',
  // Claude 4 series
  'anthropic/claude-opus-4': 'claude-opus-4-20250514',
  'anthropic/claude-sonnet-4': 'claude-sonnet-4-20250514',
  // Claude 3.7 series
  'anthropic/claude-3.7-sonnet': 'claude-3-7-sonnet-20250219',
  'anthropic/claude-3.7-sonnet:thinking': 'claude-3-7-sonnet-20250219',
  // Claude 3.5 series
  'anthropic/claude-3.5-sonnet': 'claude-3-5-sonnet-20241022',
  'anthropic/claude-3.5-haiku': 'claude-3-5-haiku-20241022',
  'anthropic/claude-3.5-haiku-20241022': 'claude-3-5-haiku-20241022',
  // Claude 3 series
  'anthropic/claude-3-opus': 'claude-3-opus-20240229',
  'anthropic/claude-3-haiku': 'claude-3-haiku-20240307',
};

/**
 * Providers that use Anthropic model IDs directly
 */
const ANTHROPIC_PROVIDERS = ['anthropic', 'claude-pro-max'];

/**
 * Ensure config directory exists
 */
function ensureConfigDir(): void {
  const configDir = join(homedir(), '.config', 'karl');
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
}

/**
 * Load cached registry from disk
 */
export function loadRegistry(): ModelRegistry | null {
  if (!existsSync(REGISTRY_PATH)) {
    return null;
  }

  try {
    const content = readFileSync(REGISTRY_PATH, 'utf-8');
    return JSON.parse(content) as ModelRegistry;
  } catch {
    return null;
  }
}

/**
 * Save registry to disk
 */
function saveRegistry(registry: ModelRegistry): void {
  ensureConfigDir();
  writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + '\n');
}

/**
 * Check if registry is stale (older than 24 hours)
 */
export function isRegistryStale(registry: ModelRegistry | null): boolean {
  if (!registry) return true;
  return Date.now() - registry.lastSync > STALE_THRESHOLD_MS;
}

/**
 * Sync registry from OpenRouter API
 */
export async function syncRegistry(): Promise<ModelRegistry> {
  const response = await fetch(OPENROUTER_API);
  if (!response.ok) {
    throw new Error(`Failed to fetch models from OpenRouter: ${response.status}`);
  }

  const data = (await response.json()) as { data: OpenRouterModel[] };

  const registry: ModelRegistry = {
    lastSync: Date.now(),
    models: data.data,
  };

  saveRegistry(registry);
  return registry;
}

/**
 * Get registry, auto-syncing if stale
 * Pass offline=true to skip auto-sync
 */
export async function getRegistry(offline = false): Promise<ModelRegistry | null> {
  let registry = loadRegistry();

  if (!offline && isRegistryStale(registry)) {
    try {
      registry = await syncRegistry();
    } catch (error) {
      // If sync fails and we have a cached registry, use it
      if (registry) {
        console.error('Warning: Failed to sync registry, using cached data');
      } else {
        throw error;
      }
    }
  }

  return registry;
}

/**
 * Get models with optional filtering
 */
export function getModels(registry: ModelRegistry, filter?: ModelFilter): OpenRouterModel[] {
  let models = registry.models;

  if (filter?.provider) {
    const prefix = filter.provider.toLowerCase() + '/';
    models = models.filter(m => m.id.toLowerCase().startsWith(prefix));
  }

  if (filter?.tokenizer) {
    const tokenizer = filter.tokenizer.toLowerCase();
    models = models.filter(m =>
      m.architecture.tokenizer.toLowerCase().includes(tokenizer)
    );
  }

  if (filter?.search) {
    const search = filter.search.toLowerCase();
    models = models.filter(m =>
      m.id.toLowerCase().includes(search) ||
      m.name.toLowerCase().includes(search) ||
      m.description.toLowerCase().includes(search)
    );
  }

  return models;
}

/**
 * Map OpenRouter model ID to provider-specific model ID
 *
 * For Anthropic providers (anthropic, claude-pro-max), maps to Anthropic API IDs
 * For other providers, returns the OpenRouter ID as-is
 */
export function mapToProvider(openRouterId: string, providerKey: string): string {
  if (ANTHROPIC_PROVIDERS.includes(providerKey)) {
    return ANTHROPIC_MODEL_MAP[openRouterId] ?? openRouterId;
  }

  // For OpenRouter and other providers, use the ID as-is
  return openRouterId;
}

/**
 * Check if a model is available for a given provider
 */
export function isModelAvailableForProvider(model: OpenRouterModel, providerKey: string): boolean {
  const modelProvider = model.id.split('/')[0];

  if (providerKey === 'openrouter') {
    return true; // OpenRouter supports all models
  }

  if (ANTHROPIC_PROVIDERS.includes(providerKey)) {
    return modelProvider === 'anthropic';
  }

  if (providerKey === 'openai') {
    return modelProvider === 'openai';
  }

  // Unknown provider, assume available
  return true;
}

/**
 * Get available providers for a model
 */
export function getProvidersForModel(model: OpenRouterModel): string[] {
  const providers = ['openrouter']; // Always available on OpenRouter
  const modelProvider = model.id.split('/')[0];

  if (modelProvider === 'anthropic') {
    providers.push('claude-pro-max', 'anthropic');
  } else if (modelProvider === 'openai') {
    providers.push('openai');
  }

  return providers;
}

/**
 * Format pricing for display
 */
export function formatPricing(model: OpenRouterModel): string {
  const prompt = parseFloat(model.pricing.prompt) * 1_000_000;
  const completion = parseFloat(model.pricing.completion) * 1_000_000;

  if (prompt === 0 && completion === 0) {
    return 'Free';
  }

  // Handle invalid/negative pricing (OpenRouter internal models)
  if (prompt < 0 || completion < 0 || isNaN(prompt) || isNaN(completion)) {
    return 'Variable';
  }

  return `$${prompt.toFixed(2)}/$${completion.toFixed(2)} per 1M`;
}

/**
 * Format context length for display
 */
export function formatContextLength(contextLength: number): string {
  if (contextLength >= 1_000_000) {
    return `${(contextLength / 1_000_000).toFixed(1)}M`;
  }
  return `${Math.round(contextLength / 1000)}K`;
}
