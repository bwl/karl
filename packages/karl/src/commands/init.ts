/**
 * First-run initialization wizard (CLI-based)
 *
 * Creates:
 * 1. A provider in ~/.config/karl/providers/
 * 2. A model in ~/.config/karl/models/
 * 3. The 'default' stack (required, can't be deleted)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createInterface } from 'readline';
import { ProviderConfig } from '../types.js';
import { saveModel } from './models.js';
import { saveProvider } from './providers.js';

const GLOBAL_CONFIG_PATH = join(homedir(), '.config', 'karl', 'karl.json');
const GLOBAL_STACKS_PATH = join(homedir(), '.config', 'karl', 'stacks');

/**
 * Known provider templates
 */
const PROVIDER_TEMPLATES: Record<string, { type: string; config: Partial<ProviderConfig>; models: string[]; envVar?: string }> = {
  anthropic: {
    type: 'anthropic',
    config: { type: 'anthropic', apiKey: '${ANTHROPIC_API_KEY}' },
    models: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-haiku-3-5-20241022'],
    envVar: 'ANTHROPIC_API_KEY',
  },
  'claude-pro-max': {
    type: 'anthropic',
    config: { type: 'anthropic', authType: 'oauth' },
    models: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-haiku-3-5-20241022'],
  },
  openrouter: {
    type: 'openai',
    config: { type: 'openai', baseUrl: 'https://openrouter.ai/api/v1', apiKey: '${OPENROUTER_API_KEY}' },
    models: ['anthropic/claude-sonnet-4', 'anthropic/claude-opus-4', 'openai/gpt-4o', 'google/gemini-2.0-flash-exp'],
    envVar: 'OPENROUTER_API_KEY',
  },
  openai: {
    type: 'openai',
    config: { type: 'openai', apiKey: '${OPENAI_API_KEY}' },
    models: ['gpt-4o', 'gpt-4o-mini', 'o1', 'o1-mini'],
    envVar: 'OPENAI_API_KEY',
  },
  antigravity: {
    type: 'openai',
    config: {
      type: 'openai',
      baseUrl: 'http://localhost:8317/v1',
      apiKey: 'not-needed',
    },
    models: [
      'gemini-claude-sonnet-4-5',
      'gemini-claude-opus-4-5-thinking',
      'gemini-2.5-flash',
      'gemini-2.5-pro',
      'gpt-oss-120b-medium',
    ],
  },
};

function prompt(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

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

function writeGlobalConfig(config: Record<string, unknown>): void {
  const dir = join(homedir(), '.config', 'karl');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
}

/**
 * Ensure the 'default' stack exists
 */
export function ensureDefaultStack(modelAlias?: string): void {
  if (!existsSync(GLOBAL_STACKS_PATH)) {
    mkdirSync(GLOBAL_STACKS_PATH, { recursive: true });
  }

  const defaultStackPath = join(GLOBAL_STACKS_PATH, 'default.json');

  if (!existsSync(defaultStackPath)) {
    const stack: Record<string, unknown> = {};
    if (modelAlias) {
      stack.model = modelAlias;
    }
    writeFileSync(defaultStackPath, JSON.stringify(stack, null, 2) + '\n');
  }
}

/**
 * Check if default stack exists
 */
export function defaultStackExists(): boolean {
  const defaultStackPath = join(GLOBAL_STACKS_PATH, 'default.json');
  return existsSync(defaultStackPath);
}

/**
 * Run the first-run initialization wizard
 */
export async function runInitWizard(): Promise<boolean> {
  console.log('');
  console.log('Welcome to Karl! Let\'s set up your first model.\n');

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    // Show provider options
    console.log('Available providers:');
    const providerNames = Object.keys(PROVIDER_TEMPLATES);
    providerNames.forEach((name, i) => {
      const template = PROVIDER_TEMPLATES[name];
      const authType = template.config.authType === 'oauth' ? 'OAuth (Claude Pro/Max subscription)' : 'API Key';
      console.log(`  ${i + 1}. ${name} - ${authType}`);
    });
    console.log('');

    const providerInput = await prompt(rl, 'Select provider [1]: ') || '1';
    const providerIndex = parseInt(providerInput, 10);

    if (providerIndex < 1 || providerIndex > providerNames.length) {
      console.error('Invalid selection.');
      rl.close();
      return false;
    }

    const providerKey = providerNames[providerIndex - 1];
    const template = PROVIDER_TEMPLATES[providerKey];
    const providerConfig = { ...template.config } as ProviderConfig;

    // For API key providers, get the key
    if (template.envVar) {
      if (process.env[template.envVar]) {
        console.log(`\n✓ Found ${template.envVar} in environment.`);
      } else {
        console.log(`\nNo ${template.envVar} found in environment.`);
        const apiKey = await prompt(rl, `Enter API key (or set ${template.envVar} later): `);
        if (apiKey) {
          providerConfig.apiKey = apiKey;
        }
      }
    } else if (template.config.authType === 'oauth') {
      console.log('\nNote: You\'ll need to run `karl --login` to authenticate with OAuth.');
    }

    // Show model options
    console.log('\nAvailable models:');
    template.models.forEach((m, i) => {
      console.log(`  ${i + 1}. ${m}`);
    });
    console.log('');

    const modelInput = await prompt(rl, 'Select model [1]: ') || '1';
    const modelIndex = parseInt(modelInput, 10);

    let modelId: string;
    if (modelIndex >= 1 && modelIndex <= template.models.length) {
      modelId = template.models[modelIndex - 1];
    } else {
      modelId = modelInput;
    }

    // Get model alias
    const suggestedAlias = modelId.includes('/') ? modelId.split('/').pop()! : modelId.split('-')[0];
    const alias = await prompt(rl, `Model alias [${suggestedAlias}]: `) || suggestedAlias;

    rl.close();

    // Save provider to folder
    saveProvider(providerKey, providerConfig);

    // Save model to folder
    saveModel(alias, {
      provider: providerKey,
      model: modelId,
    });

    // Set default model in global config
    const globalConfig = readGlobalConfig();
    globalConfig.defaultModel = alias;
    writeGlobalConfig(globalConfig);

    // Create default stack pointing to this model
    ensureDefaultStack(alias);

    console.log('\n✓ Setup complete!\n');
    console.log(`  Model: ${alias} → ${providerKey}/${modelId}`);
    console.log(`  Default stack created: ~/.config/karl/stacks/default.json`);
    console.log('');
    console.log('You can now use:');
    console.log('  karl run "your task"');
    console.log('');
    console.log('To add more models:');
    console.log('  karl models add');
    console.log('');

    if (template.config.authType === 'oauth') {
      console.log('Don\'t forget to authenticate:');
      console.log('  karl --login');
      console.log('');
    }

    return true;
  } catch (error) {
    rl.close();
    throw error;
  }
}

/**
 * Handle init command
 */
export async function handleInitCommand(): Promise<void> {
  await runInitWizard();
}
