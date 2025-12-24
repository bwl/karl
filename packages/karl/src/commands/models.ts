/**
 * CLI commands for managing models
 *
 * Models are stored as individual JSON files in ~/.config/karl/models/
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import { spawnSync } from 'child_process';
import { createInterface } from 'readline';
import { loadConfig } from '../config.js';
import { ModelConfig } from '../types.js';
import {
  syncRegistry,
  getRegistry,
  getModels,
  mapToProvider,
  isModelAvailableForProvider,
  getProvidersForModel,
  formatPricing,
  formatContextLength,
  isRegistryStale,
  loadRegistry,
  type OpenRouterModel,
} from '../registry.js';

const GLOBAL_CONFIG_PATH = join(homedir(), '.config', 'karl', 'karl.json');
const MODELS_DIR = join(homedir(), '.config', 'karl', 'models');

/**
 * Fetch model metadata from OpenRouter API
 */
async function fetchOpenRouterModelInfo(modelId: string): Promise<Partial<ModelConfig> | null> {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models');
    if (!response.ok) return null;

    const data = await response.json() as { data: Array<{
      id: string;
      name: string;
      description?: string;
      context_length?: number;
      top_provider?: { max_completion_tokens?: number };
      pricing?: { prompt: string; completion: string };
    }> };

    const model = data.data.find(m => m.id === modelId);
    if (!model) return null;

    return {
      maxTokens: model.top_provider?.max_completion_tokens,
      contextLength: model.context_length,
      description: model.description,
      pricing: model.pricing ? {
        prompt: parseFloat(model.pricing.prompt) * 1_000_000,
        completion: parseFloat(model.pricing.completion) * 1_000_000,
      } : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Ensure models directory exists
 */
function ensureModelsDir(): void {
  if (!existsSync(MODELS_DIR)) {
    mkdirSync(MODELS_DIR, { recursive: true });
  }
}

/**
 * Load all models from the models directory
 */
export function loadModelsFromDir(): Record<string, ModelConfig> {
  const models: Record<string, ModelConfig> = {};

  if (!existsSync(MODELS_DIR)) {
    return models;
  }

  try {
    const entries = readdirSync(MODELS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;

      const alias = basename(entry.name, '.json');
      const filePath = join(MODELS_DIR, entry.name);

      try {
        const content = JSON.parse(readFileSync(filePath, 'utf-8'));
        models[alias] = content;
      } catch {
        // Skip invalid files
      }
    }
  } catch {
    // Ignore errors
  }

  return models;
}

/**
 * Check if a model exists
 */
export function modelExists(alias: string): boolean {
  const filePath = join(MODELS_DIR, `${alias}.json`);
  return existsSync(filePath);
}

/**
 * Save a model to the models directory
 */
export function saveModel(alias: string, config: ModelConfig): void {
  ensureModelsDir();
  const filePath = join(MODELS_DIR, `${alias}.json`);
  writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n');
}

/**
 * Read the raw global config
 */
function readGlobalConfig(): Record<string, unknown> {
  if (!existsSync(GLOBAL_CONFIG_PATH)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(GLOBAL_CONFIG_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

/**
 * Write the global config
 */
function writeGlobalConfig(config: Record<string, unknown>): void {
  const dir = join(homedir(), '.config', 'karl');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
}

function readProjectConfig(): Record<string, unknown> {
  const projectPath = join(process.cwd(), '.karl.json');
  if (!existsSync(projectPath)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(projectPath, 'utf-8'));
  } catch {
    return {};
  }
}

function openInEditor(filePath: string): void {
  const editor = process.env.EDITOR || process.env.VISUAL;
  if (editor) {
    spawnSync(editor, [filePath], { stdio: 'inherit' });
  } else {
    console.log(`File: ${filePath}`);
    console.log('Set $EDITOR to open automatically.');
  }
}

/**
 * Prompt helper
 */
function prompt(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

export interface ListModelsOptions {
  namesOnly?: boolean;  // For shell completion
}

/**
 * List all configured models
 */
export async function listModels(options: ListModelsOptions = {}) {
  const cwd = process.cwd();
  const config = await loadConfig(cwd);
  const entries = Object.entries(config.models ?? {});

  // Names-only mode for shell completion
  if (options.namesOnly) {
    for (const [alias] of entries) {
      console.log(alias);
    }
    return;
  }

  if (entries.length === 0) {
    console.log('No models configured.');
    console.log('');
    console.log('Add a model with: karl models add');
    return;
  }

  console.log(`Found ${entries.length} model${entries.length === 1 ? '' : 's'}:\n`);

  for (const [alias, model] of entries) {
    const isDefault = alias === config.defaultModel;
    console.log(`${isDefault ? '◉' : '○'} ${alias.padEnd(20)} ${model.provider}/${model.model}`);
  }

  console.log('');
  console.log(`Default: ${config.defaultModel || '(none)'}`);
}

/**
 * Show details of a specific model
 */
export async function showModel(alias: string) {
  const cwd = process.cwd();
  const config = await loadConfig(cwd);
  const model = config.models?.[alias];

  if (!model) {
    console.error(`Model "${alias}" not found.`);
    process.exit(1);
  }

  const provider = config.providers?.[model.provider];
  const isDefault = alias === config.defaultModel;

  console.log(`# ${alias}${isDefault ? ' (default)' : ''}\n`);
  console.log(`**Provider:** ${model.provider}`);
  console.log(`**Model:** ${model.model}`);

  if (provider) {
    console.log(`**Provider Type:** ${provider.type}`);
    if (provider.baseUrl) {
      console.log(`**Base URL:** ${provider.baseUrl}`);
    }
    console.log(`**Auth:** ${provider.authType === 'oauth' ? 'OAuth' : 'API Key'}`);
  }
}

/**
 * Known provider templates with common models
 * Note: Anthropic models are fetched dynamically from the API
 */
const PROVIDER_MODELS: Record<string, string[]> = {
  openrouter: [
    'anthropic/claude-sonnet-4',
    'anthropic/claude-opus-4',
    'openai/gpt-4o',
    'google/gemini-2.0-flash-exp',
  ],
  openai: [
    'gpt-4o',
    'gpt-4o-mini',
    'o1',
    'o1-mini',
  ],
};

/**
 * Map Karl provider key to OpenRouter provider prefix
 */
function getProviderPrefix(providerKey: string): string | undefined {
  const mapping: Record<string, string> = {
    'anthropic': 'anthropic',
    'claude-pro-max': 'anthropic',
    'openai': 'openai',
    'openrouter': undefined as unknown as string, // No filter for openrouter
  };
  return mapping[providerKey];
}

export interface AddModelOptions {
  alias: string;
  provider?: string;
  model?: string;
  setDefault?: boolean;
}

/**
 * Add a model (interactive or non-interactive)
 */
export async function addModel(options: AddModelOptions) {
  const cwd = process.cwd();
  const config = await loadConfig(cwd);

  const { alias } = options;
  let { provider: providerKey, model: modelId } = options;

  // Check if alias already exists
  if (config.models?.[alias]) {
    console.error(`Model "${alias}" already exists. Remove it first with: karl models remove ${alias}`);
    process.exit(1);
  }

  const providers = config.providers ?? {};
  const providerNames = Object.keys(providers);

  if (providerNames.length === 0) {
    console.error('No providers configured.');
    console.error('');
    console.error('Add a provider first with: karl providers add');
    process.exit(1);
  }

  // Non-interactive mode: require both provider and model
  if (providerKey && modelId) {
    if (!providers[providerKey]) {
      console.error(`Provider "${providerKey}" not found.`);
      console.error(`Available: ${providerNames.join(', ')}`);
      process.exit(1);
    }

    // Fetch metadata for OpenRouter models
    let metadata: Partial<ModelConfig> = {};
    if (providerKey === 'openrouter') {
      console.log('Fetching model metadata from OpenRouter...');
      const info = await fetchOpenRouterModelInfo(modelId);
      if (info) {
        metadata = info;
      }
    }

    saveModel(alias, { provider: providerKey, model: modelId, ...metadata });

    if (options.setDefault) {
      const globalConfig = readGlobalConfig();
      globalConfig.defaultModel = alias;
      writeGlobalConfig(globalConfig);
    }

    console.log(`✓ Model "${alias}" added.`);
    console.log(`  ${providerKey}/${modelId}`);
    if (metadata.maxTokens) {
      console.log(`  Max tokens: ${metadata.maxTokens}`);
    }
    if (metadata.contextLength) {
      console.log(`  Context: ${metadata.contextLength}`);
    }
    return;
  }

  // Interactive mode
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    // Get provider if not provided
    if (!providerKey) {
      console.log('\nAvailable providers:');
      providerNames.forEach((name, i) => {
        const provider = providers[name];
        const authType = provider.authType === 'oauth' ? 'OAuth' : 'API Key';
        console.log(`  ${i + 1}. ${name} (${authType})`);
      });
      console.log('');

      const providerInput = await prompt(rl, 'Provider [1]: ') || '1';
      const providerIndex = parseInt(providerInput, 10);

      if (providerIndex >= 1 && providerIndex <= providerNames.length) {
        providerKey = providerNames[providerIndex - 1];
      } else {
        providerKey = providerInput;
      }
    }

    if (!providers[providerKey]) {
      console.error(`Provider "${providerKey}" not found.`);
      rl.close();
      process.exit(1);
    }

    // Get model if not provided
    if (!modelId) {
      // Try to use the model registry
      let registry = loadRegistry();

      if (!registry || isRegistryStale(registry)) {
        console.log('\nSyncing model registry...');
        try {
          registry = await syncRegistry();
        } catch (error) {
          if (registry) {
            console.log('Warning: Could not sync, using cached registry');
          } else {
            console.error(`\nFailed to sync registry: ${(error as Error).message}`);
            console.error('Run `karl models sync` to fetch available models.');
            rl.close();
            process.exit(1);
          }
        }
      }

      // Filter models by provider
      const providerPrefix = getProviderPrefix(providerKey);
      const availableModels = registry
        ? getModels(registry, { provider: providerPrefix }).filter(m =>
            isModelAvailableForProvider(m, providerKey!)
          )
        : [];

      if (availableModels.length > 0) {
        console.log(`\nAvailable models for ${providerKey}:`);
        const displayModels = availableModels.slice(0, 20);
        displayModels.forEach((m, i) => {
          console.log(`  ${i + 1}. ${m.name} (${m.id})`);
        });
        if (availableModels.length > 20) {
          console.log(`  ... and ${availableModels.length - 20} more (use 'karl models browse' to see all)`);
        }
        console.log(`  Or enter a custom model ID`);
        console.log('');

        const modelInput = await prompt(rl, 'Model [1]: ') || '1';
        const modelIndex = parseInt(modelInput, 10);

        if (modelIndex >= 1 && modelIndex <= displayModels.length) {
          const selectedModel = displayModels[modelIndex - 1];
          // Map to provider-specific model ID
          modelId = mapToProvider(selectedModel.id, providerKey);
        } else {
          modelId = modelInput;
        }
      } else {
        // No models in registry for this provider
        modelId = await prompt(rl, 'Model ID: ');
        if (!modelId) {
          console.error('Model ID is required.');
          rl.close();
          process.exit(1);
        }
      }
    }

    rl.close();

    // Fetch metadata for OpenRouter models
    let metadata: Partial<ModelConfig> = {};
    if (providerKey === 'openrouter') {
      console.log('\nFetching model metadata from OpenRouter...');
      const info = await fetchOpenRouterModelInfo(modelId);
      if (info) {
        metadata = info;
      }
    }

    saveModel(alias, { provider: providerKey, model: modelId, ...metadata });

    // Set as default if first model or requested
    const models = loadModelsFromDir();
    if (Object.keys(models).length === 1 || options.setDefault) {
      const globalConfig = readGlobalConfig();
      globalConfig.defaultModel = alias;
      writeGlobalConfig(globalConfig);
      if (Object.keys(models).length === 1) {
        console.log(`\nSetting "${alias}" as the default model.`);
      }
    }

    console.log(`\n✓ Model "${alias}" added.`);
    console.log(`  Provider: ${providerKey}`);
    console.log(`  Model: ${modelId}`);
    if (metadata.maxTokens) {
      console.log(`  Max tokens: ${metadata.maxTokens}`);
    }
    if (metadata.contextLength) {
      console.log(`  Context: ${metadata.contextLength}`);
    }

  } catch (error) {
    rl.close();
    throw error;
  }
}

/**
 * Remove a model
 */
export async function removeModel(alias: string) {
  if (!modelExists(alias)) {
    console.error(`Model "${alias}" not found.`);
    process.exit(1);
  }

  const filePath = join(MODELS_DIR, `${alias}.json`);
  unlinkSync(filePath);

  // Update default if we removed it
  const globalConfig = readGlobalConfig();
  if (globalConfig.defaultModel === alias) {
    const models = loadModelsFromDir();
    const remaining = Object.keys(models);
    if (remaining.length > 0) {
      globalConfig.defaultModel = remaining[0];
      writeGlobalConfig(globalConfig);
      console.log(`Default model changed to "${globalConfig.defaultModel}".`);
    } else {
      delete globalConfig.defaultModel;
      writeGlobalConfig(globalConfig);
    }
  }

  console.log(`✓ Model "${alias}" removed.`);
}

/**
 * Edit a model (opens the model file or config containing it)
 */
export async function editModel(alias: string) {
  const filePath = join(MODELS_DIR, `${alias}.json`);
  if (existsSync(filePath)) {
    openInEditor(filePath);
    return;
  }

  const projectPath = join(process.cwd(), '.karl.json');
  const projectConfig = readProjectConfig();
  const projectModels = projectConfig.models as Record<string, unknown> | undefined;
  if (projectModels && Object.prototype.hasOwnProperty.call(projectModels, alias)) {
    openInEditor(projectPath);
    return;
  }

  const globalConfig = readGlobalConfig();
  const globalModels = globalConfig.models as Record<string, unknown> | undefined;
  if (globalModels && Object.prototype.hasOwnProperty.call(globalModels, alias)) {
    openInEditor(GLOBAL_CONFIG_PATH);
    return;
  }

  console.error(`Model "${alias}" not found.`);
  process.exit(1);
}

/**
 * Set the default model
 */
export async function setDefaultModel(alias: string) {
  if (!modelExists(alias)) {
    console.error(`Model "${alias}" not found.`);
    console.error('');
    const models = loadModelsFromDir();
    console.error('Available models:');
    for (const name of Object.keys(models)) {
      console.error(`  - ${name}`);
    }
    process.exit(1);
  }

  const globalConfig = readGlobalConfig();
  globalConfig.defaultModel = alias;
  writeGlobalConfig(globalConfig);

  console.log(`✓ Default model set to "${alias}".`);
}

/**
 * Refresh model metadata from OpenRouter API
 */
export async function refreshModels() {
  const cwd = process.cwd();
  const config = await loadConfig(cwd);
  const models = config.models ?? {};

  const openRouterModels = Object.entries(models).filter(
    ([_, m]) => m.provider === 'openrouter'
  );

  if (openRouterModels.length === 0) {
    console.log('No OpenRouter models to refresh.');
    return;
  }

  console.log(`Fetching metadata for ${openRouterModels.length} OpenRouter model(s)...\n`);

  let updated = 0;
  for (const [alias, modelConfig] of openRouterModels) {
    const info = await fetchOpenRouterModelInfo(modelConfig.model);
    if (info) {
      const updatedConfig: ModelConfig = {
        ...modelConfig,
        ...info,
      };
      saveModel(alias, updatedConfig);
      console.log(`✓ ${alias}: ${info.maxTokens ?? '?'} max tokens, ${info.contextLength ?? '?'} context`);
      updated++;
    } else {
      console.log(`✗ ${alias}: not found in OpenRouter API`);
    }
  }

  console.log(`\nUpdated ${updated}/${openRouterModels.length} models.`);
}

/**
 * Sync model registry from OpenRouter
 */
export async function syncModelsRegistry() {
  console.log('Syncing models from OpenRouter...\n');

  try {
    const registry = await syncRegistry();
    console.log(`✓ Synced ${registry.models.length} models from OpenRouter`);
  } catch (error) {
    console.error(`Failed to sync: ${(error as Error).message}`);
    process.exit(1);
  }
}

/**
 * Parse browse command flags
 */
interface BrowseOptions {
  provider?: string;
  search?: string;
  offline?: boolean;
}

function parseBrowseArgs(args: string[]): BrowseOptions {
  const options: BrowseOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--provider' || arg === '-p') {
      options.provider = args[++i];
    } else if (arg === '--search' || arg === '-s') {
      options.search = args[++i];
    } else if (arg === '--offline') {
      options.offline = true;
    } else if (!arg.startsWith('-')) {
      // Backwards compat: positional arg is provider
      options.provider = arg;
    }
  }

  return options;
}

/**
 * Browse available models from the registry
 */
export async function browseModelsFromRegistry(options: BrowseOptions) {
  const registry = await getRegistry(options.offline);

  if (!registry) {
    console.error('No model registry found.');
    console.error('');
    console.error('Run `karl models sync` to fetch available models.');
    process.exit(1);
  }

  const models = getModels(registry, {
    provider: options.provider,
    search: options.search,
  });

  if (models.length === 0) {
    console.log('No models found matching your criteria.');
    return;
  }

  console.log(`Found ${models.length} models:\n`);

  for (const model of models.slice(0, 50)) {
    const providers = getProvidersForModel(model);
    const contextStr = formatContextLength(model.context_length);
    const pricingStr = formatPricing(model);

    console.log(`  ${model.id}`);
    console.log(`    ${model.name} - ${contextStr} context, ${pricingStr}`);
    console.log(`    Providers: ${providers.join(', ')}`);
    console.log('');
  }

  if (models.length > 50) {
    console.log(`  ... and ${models.length - 50} more`);
    console.log('');
    console.log('Use --search to filter results.');
  }

  // Show stale warning if applicable
  if (isRegistryStale(registry)) {
    const lastSyncDate = new Date(registry.lastSync).toLocaleDateString();
    console.log(`\nRegistry last synced: ${lastSyncDate}`);
    console.log('Run `karl models sync` to get latest models.');
  }
}


/**
 * Handle models subcommands
 */
export async function handleModelsCommand(args: string[]) {
  const [command, ...rest] = args;

  switch (command) {
    case 'list':
    case 'ls': {
      const namesOnly = rest.includes('--names');
      await listModels({ namesOnly });
      break;
    }

    case 'show':
    case 'info':
      if (rest.length === 0) {
        console.error('Usage: karl models show <alias>');
        process.exit(1);
      }
      await showModel(rest[0]);
      break;

    case 'add':
    case 'new':
    case 'create': {
      if (rest.length === 0) {
        console.error('Usage: karl models add <alias> [--provider <name>] [--model <id>]');
        console.error('       karl models add <alias> <provider>/<model>');
        process.exit(1);
      }

      const alias = rest[0];
      let provider: string | undefined;
      let model: string | undefined;
      let setDefault = false;

      // Check for shorthand: alias provider/model
      if (rest[1] && rest[1].includes('/') && !rest[1].startsWith('--')) {
        const parts = rest[1].split('/');
        provider = parts[0];
        model = parts.slice(1).join('/');  // Handle models like openai/gpt-4o or org/model:tag
      } else {
        // Parse flags
        for (let i = 1; i < rest.length; i++) {
          if ((rest[i] === '--provider' || rest[i] === '-p') && rest[i + 1]) {
            provider = rest[++i];
          } else if ((rest[i] === '--model' || rest[i] === '-m') && rest[i + 1]) {
            model = rest[++i];
          } else if (rest[i] === '--default' || rest[i] === '-d') {
            setDefault = true;
          }
        }
      }

      await addModel({ alias, provider, model, setDefault });
      break;
    }

    case 'remove':
    case 'rm':
    case 'delete':
      if (rest.length === 0) {
        console.error('Usage: karl models remove <alias>');
        process.exit(1);
      }
      await removeModel(rest[0]);
      break;

    case 'default':
    case 'set-default':
      if (rest.length === 0) {
        console.error('Usage: karl models default <alias>');
        process.exit(1);
      }
      await setDefaultModel(rest[0]);
      break;

    case 'edit':
      if (rest.length === 0) {
        console.error('Usage: karl models edit <alias>');
        process.exit(1);
      }
      await editModel(rest[0]);
      break;

    case 'refresh':
    case 'update':
      await refreshModels();
      break;

    case 'sync':
      await syncModelsRegistry();
      break;

    case 'browse': {
      const browseOpts = parseBrowseArgs(rest);
      await browseModelsFromRegistry(browseOpts);
      break;
    }

    default:
      if (!command) {
        console.error('Usage: karl models <command>');
        console.error('');
        console.error('Commands:');
        console.error('  list              List configured models');
        console.error('  show <alias>      Show model details');
        console.error('  add [alias]       Add a new model');
        console.error('  remove <alias>    Remove a model');
        console.error('  edit <alias>      Edit a model file');
        console.error('  default <alias>   Set the default model');
        console.error('  sync              Sync model registry from OpenRouter');
        console.error('  browse            Browse available models');
        console.error('  refresh           Update OpenRouter model metadata');
        console.error('');
        console.error('Browse options:');
        console.error('  --provider, -p    Filter by provider (anthropic, openai, etc.)');
        console.error('  --search, -s      Search in model names/descriptions');
        console.error('  --offline         Use cached registry without syncing');
      } else {
        console.error(`Unknown models command: ${command}`);
        console.error('Available commands: list, show, add, remove, edit, default, sync, browse, refresh');
      }
      process.exit(1);
  }
}
