/**
 * CLI commands for managing models
 *
 * Models are stored as individual JSON files in ~/.config/karl/models/
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import { createInterface } from 'readline';
import { loadConfig } from '../config.js';
import { ModelConfig, ProviderConfig } from '../types.js';
import { loadProvidersFromDir, providerExists } from './providers.js';

const GLOBAL_CONFIG_PATH = join(homedir(), '.config', 'karl', 'karl.json');
const MODELS_DIR = join(homedir(), '.config', 'karl', 'models');

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

/**
 * Prompt helper
 */
function prompt(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

/**
 * List all configured models
 */
export async function listModels() {
  const cwd = process.cwd();
  const config = await loadConfig(cwd);
  const entries = Object.entries(config.models ?? {});

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
 */
const PROVIDER_MODELS: Record<string, string[]> = {
  anthropic: [
    'claude-sonnet-4-20250514',
    'claude-opus-4-20250514',
    'claude-haiku-3-5-20241022',
  ],
  'claude-pro-max': [
    'claude-sonnet-4-20250514',
    'claude-opus-4-20250514',
    'claude-haiku-3-5-20241022',
  ],
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
 * Interactive wizard to add a model
 */
export async function addModel(alias?: string) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    // Get alias if not provided
    if (!alias) {
      alias = await prompt(rl, 'Model alias (e.g., fast, smart, haiku): ');
      if (!alias) {
        console.error('Alias is required.');
        rl.close();
        return;
      }
    }

    // Check if alias already exists
    if (modelExists(alias)) {
      console.log(`Model "${alias}" already exists. Remove it first with: karl models remove ${alias}`);
      rl.close();
      return;
    }

    // Get available providers
    const providers = loadProvidersFromDir();
    const providerNames = Object.keys(providers);

    if (providerNames.length === 0) {
      console.log('No providers configured.');
      console.log('');
      console.log('Add a provider first with: karl providers add');
      rl.close();
      return;
    }

    console.log('\nAvailable providers:');
    providerNames.forEach((name, i) => {
      const provider = providers[name];
      const authType = provider.authType === 'oauth' ? 'OAuth' : 'API Key';
      console.log(`  ${i + 1}. ${name} (${authType})`);
    });
    console.log('');

    const providerInput = await prompt(rl, 'Provider [1]: ') || '1';
    const providerIndex = parseInt(providerInput, 10);

    let providerKey: string;
    if (providerIndex >= 1 && providerIndex <= providerNames.length) {
      providerKey = providerNames[providerIndex - 1];
    } else {
      providerKey = providerInput;
    }

    if (!providers[providerKey]) {
      console.error(`Provider "${providerKey}" not found.`);
      rl.close();
      return;
    }

    // Show common models for this provider
    const commonModels = PROVIDER_MODELS[providerKey] || [];
    let modelId: string;

    if (commonModels.length > 0) {
      console.log(`\nCommon ${providerKey} models:`);
      commonModels.forEach((m, i) => {
        console.log(`  ${i + 1}. ${m}`);
      });
      console.log(`  Or enter a custom model ID`);
      console.log('');

      const modelInput = await prompt(rl, 'Model [1]: ') || '1';
      const modelIndex = parseInt(modelInput, 10);

      if (modelIndex >= 1 && modelIndex <= commonModels.length) {
        modelId = commonModels[modelIndex - 1];
      } else {
        modelId = modelInput;
      }
    } else {
      modelId = await prompt(rl, 'Model ID: ');
      if (!modelId) {
        console.error('Model ID is required.');
        rl.close();
        return;
      }
    }

    rl.close();

    // Save model to file
    saveModel(alias, {
      provider: providerKey,
      model: modelId,
    });

    // Set as default if it's the first model
    const models = loadModelsFromDir();
    if (Object.keys(models).length === 1) {
      const globalConfig = readGlobalConfig();
      globalConfig.defaultModel = alias;
      writeGlobalConfig(globalConfig);
      console.log(`\nSetting "${alias}" as the default model.`);
    }

    console.log(`\n✓ Model "${alias}" added.`);
    console.log(`  Provider: ${providerKey}`);
    console.log(`  Model: ${modelId}`);
    console.log(`  Path: ${MODELS_DIR}/${alias}.json`);

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
 * Handle models subcommands
 */
export async function handleModelsCommand(args: string[]) {
  const [command, ...rest] = args;

  switch (command) {
    case 'list':
    case 'ls':
      await listModels();
      break;

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
    case 'create':
      await addModel(rest[0]);
      break;

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

    default:
      if (!command) {
        console.error('Usage: karl models <command>');
        console.error('');
        console.error('Commands:');
        console.error('  list              List configured models');
        console.error('  show <alias>      Show model details');
        console.error('  add [alias]       Add a new model');
        console.error('  remove <alias>    Remove a model');
        console.error('  default <alias>   Set the default model');
      } else {
        console.error(`Unknown models command: ${command}`);
        console.error('Available commands: list, show, add, remove, default');
      }
      process.exit(1);
  }
}
