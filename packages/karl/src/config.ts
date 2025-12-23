import path from 'path';
import { KarlConfig, CliOptions, ProviderConfig } from './types.js';
import { deepMerge, expandEnv, readTextIfExists, resolveHomePath } from './utils.js';
import { loadOAuthCredentials } from './oauth.js';
import { loadModelsFromDir } from './commands/models.js';
import { loadProvidersFromDir } from './commands/providers.js';

const DEFAULT_CONFIG: KarlConfig = {
  defaultModel: '',
  models: {},
  providers: {},
  tools: {
    enabled: ['bash', 'read', 'write', 'edit'],
    custom: ['~/.config/karl/tools/*.ts']
  },
  retry: {
    attempts: 3,
    backoff: 'exponential'
  },
  history: {
    enabled: true,
    path: '~/.config/karl/history/history.db',
    maxDiffBytes: 20000,
    maxDiffLines: 400
  }
};

function expandEnvInObject<T>(value: T): T {
  if (typeof value === 'string') {
    return expandEnv(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => expandEnvInObject(entry)) as T;
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      result[key] = expandEnvInObject(entry);
    }
    return result as T;
  }
  return value;
}

async function readConfigFile(filePath: string): Promise<Partial<KarlConfig> | null> {
  const content = await readTextIfExists(filePath);
  if (!content) {
    return null;
  }
  try {
    const parsed = JSON.parse(content) as Partial<KarlConfig>;
    return expandEnvInObject(parsed);
  } catch (error) {
    throw new Error(`Invalid config JSON at ${filePath}: ${(error as Error).message}`);
  }
}

export async function loadConfig(cwd: string): Promise<KarlConfig> {
  const globalPath = resolveHomePath('~/.config/karl/karl.json');
  const projectPath = path.join(cwd, '.karl.json');

  const globalConfig = await readConfigFile(globalPath);
  const projectConfig = await readConfigFile(projectPath);

  // Load models and providers from folders
  const models = loadModelsFromDir();
  const providers = expandEnvInObject(loadProvidersFromDir());

  let merged = deepMerge(DEFAULT_CONFIG, globalConfig ?? undefined);
  merged = deepMerge(merged, projectConfig ?? undefined);

  // Merge folder-loaded models and providers (folder takes precedence)
  merged.models = { ...merged.models, ...models };
  merged.providers = { ...merged.providers, ...providers };

  const legacyVolley = (merged as { volley?: { retryAttempts?: number; retryBackoff?: 'exponential' | 'linear' } }).volley;
  const hasRetryOverride = !!(globalConfig?.retry || projectConfig?.retry);
  if (legacyVolley && !hasRetryOverride) {
    merged.retry = {
      attempts: legacyVolley.retryAttempts ?? merged.retry.attempts,
      backoff: legacyVolley.retryBackoff ?? merged.retry.backoff
    };
  }

  return merged;
}

export interface ResolvedModel {
  model: string;
  providerKey: string;
  providerConfig: ProviderConfig;
  modelKey: string;
  maxTokens?: number;
  contextLength?: number;
}

export function resolveModel(config: KarlConfig, options: CliOptions): ResolvedModel {
  let modelKey = config.defaultModel;

  if (options.model) {
    if (config.models[options.model]) {
      modelKey = options.model;
    } else {
      const fallbackModel = config.models[modelKey] ?? Object.values(config.models)[0];
      if (!fallbackModel) {
        throw new Error('No models configured.');
      }
      const providerConfig = config.providers[fallbackModel.provider];
      if (!providerConfig) {
        throw new Error(`Provider not found: ${fallbackModel.provider}`);
      }
      return {
        model: options.model,
        providerKey: fallbackModel.provider,
        providerConfig,
        modelKey,
        maxTokens: fallbackModel.maxTokens,
        contextLength: fallbackModel.contextLength,
      };
    }
  }

  const modelConfig = config.models[modelKey] ?? Object.values(config.models)[0];
  if (!modelConfig) {
    throw new Error('No models configured.');
  }
  const providerConfig = config.providers[modelConfig.provider];
  if (!providerConfig) {
    throw new Error(`Provider not found: ${modelConfig.provider}`);
  }

  return {
    model: modelConfig.model,
    providerKey: modelConfig.provider,
    providerConfig,
    modelKey,
    maxTokens: modelConfig.maxTokens,
    contextLength: modelConfig.contextLength,
  };
}

/**
 * Check if a provider has valid credentials
 */
function hasValidCredentials(providerKey: string, providerConfig: ProviderConfig): boolean {
  if (providerConfig.authType === 'oauth') {
    // OAuth providers: check if OAuth credentials exist
    const oauthKey = providerKey === 'claude-pro-max' ? 'anthropic' : providerKey;
    const creds = loadOAuthCredentials(oauthKey);
    return creds !== null;
  } else {
    // API key providers: check if API key is set and expanded
    const apiKey = providerConfig.apiKey;
    return !!apiKey && !apiKey.includes('${');
  }
}

/**
 * Resolve the model for agent mode.
 * Uses agent.model if set, falls back to defaultModel.
 */
export function resolveAgentModel(config: KarlConfig): ResolvedModel {
  const agentModelKey = config.agent?.model || config.defaultModel;

  const modelConfig = config.models[agentModelKey] ?? Object.values(config.models)[0];
  if (!modelConfig) {
    throw new Error('No models configured for agent mode.');
  }

  const providerConfig = config.providers[modelConfig.provider];
  if (!providerConfig) {
    throw new Error(`Provider not found: ${modelConfig.provider}`);
  }

  return {
    model: modelConfig.model,
    providerKey: modelConfig.provider,
    providerConfig,
    modelKey: agentModelKey,
    maxTokens: modelConfig.maxTokens,
    contextLength: modelConfig.contextLength,
  };
}

/**
 * Check if the config has at least one usable provider+model combination.
 * Returns false if user needs to run the init wizard.
 */
export function isConfigValid(config: KarlConfig): boolean {
  // Find providers with valid credentials
  const validProviders = new Set<string>();
  for (const [providerKey, providerConfig] of Object.entries(config.providers)) {
    if (hasValidCredentials(providerKey, providerConfig)) {
      validProviders.add(providerKey);
    }
  }

  // Check if any model uses a valid provider
  for (const modelConfig of Object.values(config.models)) {
    if (validProviders.has(modelConfig.provider)) {
      return true;
    }
  }

  return false;
}
