import path from 'path';
import { CliffyConfig, CliOptions, ProviderConfig } from './types.js';
import { deepMerge, expandEnv, readTextIfExists, resolveHomePath } from './utils.js';

const DEFAULT_CONFIG: CliffyConfig = {
  defaultModel: 'fast',
  models: {
    fast: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514'
    },
    smart: {
      provider: 'anthropic',
      model: 'claude-opus-4-20250514'
    }
  },
  providers: {
    'claude-pro-max': {
      type: 'anthropic',
      authType: 'oauth'
    },
    openrouter: {
      type: 'openai',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: '${OPENROUTER_API_KEY}'
    },
    anthropic: {
      type: 'anthropic',
      apiKey: '${ANTHROPIC_API_KEY}'
    }
  },
  tools: {
    enabled: ['bash', 'read', 'write', 'edit'],
    custom: ['~/.config/cliffy/tools/*.ts']
  },
  volley: {
    maxConcurrent: 3,
    retryAttempts: 3,
    retryBackoff: 'exponential'
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

async function readConfigFile(filePath: string): Promise<Partial<CliffyConfig> | null> {
  const content = await readTextIfExists(filePath);
  if (!content) {
    return null;
  }
  try {
    const parsed = JSON.parse(content) as Partial<CliffyConfig>;
    return expandEnvInObject(parsed);
  } catch (error) {
    throw new Error(`Invalid config JSON at ${filePath}: ${(error as Error).message}`);
  }
}

export async function loadConfig(cwd: string): Promise<CliffyConfig> {
  const globalPath = resolveHomePath('~/.config/cliffy/cliffy.json');
  const projectPath = path.join(cwd, '.cliffy.json');

  const globalConfig = await readConfigFile(globalPath);
  const projectConfig = await readConfigFile(projectPath);

  let merged = deepMerge(DEFAULT_CONFIG, globalConfig ?? undefined);
  merged = deepMerge(merged, projectConfig ?? undefined);

  return merged;
}

export interface ResolvedModel {
  model: string;
  providerKey: string;
  providerConfig: ProviderConfig;
  modelKey: string;
}

export function resolveModel(config: CliffyConfig, options: CliOptions): ResolvedModel {
  let modelKey = config.defaultModel;

  if (options.fast) {
    modelKey = 'fast';
  }
  if (options.smart) {
    modelKey = 'smart';
  }

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
        modelKey
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
    modelKey
  };
}
