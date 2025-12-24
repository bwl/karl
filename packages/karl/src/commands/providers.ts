/**
 * CLI commands for managing providers
 *
 * Providers are stored as individual JSON files in ~/.config/karl/providers/
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import { spawnSync } from 'child_process';
import { createInterface } from 'readline';
import {
  loadOAuthCredentials,
  removeOAuthCredentials,
  runLoginFlow
} from '../oauth.js';
import { ProviderConfig } from '../types.js';
import { loadConfig } from '../config.js';

const PROVIDERS_DIR = join(homedir(), '.config', 'karl', 'providers');
const MODELS_DIR = join(homedir(), '.config', 'karl', 'models');
const GLOBAL_CONFIG_PATH = join(homedir(), '.config', 'karl', 'karl.json');

/**
 * Known provider templates
 */
const PROVIDER_TEMPLATES: Record<string, {
  type: string;
  config: Partial<ProviderConfig>;
  envVar?: string;
  description: string;
}> = {
  anthropic: {
    type: 'anthropic',
    config: { type: 'anthropic', apiKey: '${ANTHROPIC_API_KEY}' },
    envVar: 'ANTHROPIC_API_KEY',
    description: 'Anthropic API (requires API key)',
  },
  'claude-pro-max': {
    type: 'anthropic',
    config: { type: 'anthropic', authType: 'oauth' },
    description: 'Claude Pro/Max subscription (OAuth)',
  },
  openrouter: {
    type: 'openai',
    config: { type: 'openai', baseUrl: 'https://openrouter.ai/api/v1', apiKey: '${OPENROUTER_API_KEY}' },
    envVar: 'OPENROUTER_API_KEY',
    description: 'OpenRouter (access multiple models)',
  },
  openai: {
    type: 'openai',
    config: { type: 'openai', apiKey: '${OPENAI_API_KEY}' },
    envVar: 'OPENAI_API_KEY',
    description: 'OpenAI API',
  },
  antigravity: {
    type: 'openai',
    config: {
      type: 'openai',
      baseUrl: 'http://localhost:8317/v1',
      apiKey: 'not-needed',
    },
    description: 'Antigravity local API server (no auth required)',
  },
};

/**
 * Ensure providers directory exists
 */
function ensureProvidersDir(): void {
  if (!existsSync(PROVIDERS_DIR)) {
    mkdirSync(PROVIDERS_DIR, { recursive: true });
  }
}

/**
 * Load all providers from the providers directory
 */
export function loadProvidersFromDir(): Record<string, ProviderConfig> {
  const providers: Record<string, ProviderConfig> = {};

  if (!existsSync(PROVIDERS_DIR)) {
    return providers;
  }

  try {
    const entries = readdirSync(PROVIDERS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;

      const name = basename(entry.name, '.json');
      const filePath = join(PROVIDERS_DIR, entry.name);

      try {
        const content = JSON.parse(readFileSync(filePath, 'utf-8'));
        providers[name] = content;
      } catch {
        // Skip invalid files
      }
    }
  } catch {
    // Ignore errors
  }

  return providers;
}

/**
 * Check if a provider exists
 */
export function providerExists(name: string): boolean {
  const filePath = join(PROVIDERS_DIR, `${name}.json`);
  return existsSync(filePath);
}

/**
 * Save a provider to the providers directory
 */
export function saveProvider(name: string, config: ProviderConfig): void {
  ensureProvidersDir();
  const filePath = join(PROVIDERS_DIR, `${name}.json`);
  writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n');
}

/**
 * Delete a provider file
 */
function deleteProvider(name: string): void {
  const filePath = join(PROVIDERS_DIR, `${name}.json`);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
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
 * Get models that use a specific provider (reads directly from models dir)
 */
function getModelsUsingProvider(providerName: string): string[] {
  const models: string[] = [];

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
        if (content.provider === providerName) {
          models.push(alias);
        }
      } catch {
        // Skip invalid files
      }
    }
  } catch {
    // Ignore errors
  }

  return models;
}

function prompt(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

/**
 * Get provider status (configured, authenticated)
 */
function getProviderStatus(providerKey: string, providerConfig: ProviderConfig): {
  configured: boolean;
  authenticated: boolean;
  authMethod: string;
} {
  const isOAuth = providerConfig.authType === 'oauth';

  if (isOAuth) {
    const oauthKey = providerKey === 'claude-pro-max' ? 'anthropic' : providerKey;
    const creds = loadOAuthCredentials(oauthKey);
    return {
      configured: true,
      authenticated: creds !== null,
      authMethod: 'OAuth',
    };
  } else {
    const apiKey = providerConfig.apiKey;
    const hasKey = !!apiKey && !apiKey.includes('${');
    const envVar = apiKey?.match(/\$\{(\w+)\}/)?.[1];
    const envSet = envVar ? !!process.env[envVar] : false;

    return {
      configured: true,
      authenticated: hasKey || envSet,
      authMethod: envVar ? `$${envVar}` : 'API Key',
    };
  }
}

/**
 * List all configured providers
 */
export async function listProviders() {
  const cwd = process.cwd();
  const config = await loadConfig(cwd);
  const entries = Object.entries(config.providers ?? {});

  if (entries.length === 0) {
    console.log('No providers configured.');
    console.log('');
    console.log('Add a provider with: karl providers add');
    return;
  }

  console.log(`Found ${entries.length} provider${entries.length === 1 ? '' : 's'}:\n`);

  for (const [key, providerConfig] of entries) {
    const status = getProviderStatus(key, providerConfig);
    const statusIcon = status.authenticated ? '✓' : '○';
    const statusText = status.authenticated ? 'ready' : 'not authenticated';

    console.log(`${statusIcon} ${key.padEnd(20)} ${status.authMethod.padEnd(15)} ${statusText}`);
  }

  console.log('');
  console.log('To authenticate:');
  console.log('  karl providers login <name>     (for OAuth providers)');
  console.log('  Set environment variable        (for API key providers)');
}

/**
 * Show details of a specific provider
 */
export async function showProvider(providerKey: string) {
  const cwd = process.cwd();
  const config = await loadConfig(cwd);
  const providerConfig = config.providers?.[providerKey];

  if (!providerConfig) {
    console.error(`Provider "${providerKey}" not found.`);
    process.exit(1);
  }

  const status = getProviderStatus(providerKey, providerConfig);

  console.log(`# ${providerKey}\n`);
  console.log(`**Type:** ${providerConfig.type}`);
  console.log(`**Auth Method:** ${status.authMethod}`);
  console.log(`**Status:** ${status.authenticated ? 'Authenticated ✓' : 'Not authenticated'}`);

  if (providerConfig.baseUrl) {
    console.log(`**Base URL:** ${providerConfig.baseUrl}`);
  }

  // Show which models use this provider
  const models = getModelsUsingProvider(providerKey);

  if (models.length > 0) {
    console.log(`\n**Models using this provider:**`);
    for (const alias of models) {
      console.log(`  - ${alias}`);
    }
  }
}

/**
 * Add a new provider
 */
export async function addProvider(providerKey?: string) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    if (!providerKey) {
      console.log('Available provider templates:');
      const templateNames = Object.keys(PROVIDER_TEMPLATES);
      templateNames.forEach((name, i) => {
        const template = PROVIDER_TEMPLATES[name];
        console.log(`  ${i + 1}. ${name} - ${template.description}`);
      });
      console.log(`  ${templateNames.length + 1}. custom`);
      console.log('');

      const input = await prompt(rl, 'Select provider [1]: ') || '1';
      const index = parseInt(input, 10);

      if (index >= 1 && index <= templateNames.length) {
        providerKey = templateNames[index - 1];
      } else {
        providerKey = await prompt(rl, 'Provider name: ');
        if (!providerKey) {
          console.error('Provider name is required.');
          rl.close();
          return;
        }
      }
    }

    // Check if already exists
    if (providerExists(providerKey)) {
      console.log(`Provider "${providerKey}" already exists.`);
      console.log(`Remove it first with: karl providers remove ${providerKey}`);
      rl.close();
      return;
    }

    let providerConfig: ProviderConfig;
    const template = PROVIDER_TEMPLATES[providerKey];

    if (template) {
      providerConfig = { ...template.config } as ProviderConfig;

      // For API key providers, optionally get the key
      if (template.envVar) {
        if (process.env[template.envVar]) {
          console.log(`\n✓ Found ${template.envVar} in environment.`);
        } else {
          console.log(`\nNo ${template.envVar} found in environment.`);
          const apiKey = await prompt(rl, `Enter API key (or press Enter to use $${template.envVar}): `);
          if (apiKey) {
            providerConfig.apiKey = apiKey;
          }
        }
      }
    } else {
      // Custom provider
      const providerType = await prompt(rl, 'Provider type (anthropic/openai) [openai]: ') || 'openai';
      const baseUrl = await prompt(rl, 'Base URL (optional): ');
      const authType = await prompt(rl, 'Auth type (api_key/oauth) [api_key]: ') || 'api_key';

      providerConfig = {
        type: providerType,
        ...(baseUrl && { baseUrl }),
      };

      if (authType === 'oauth') {
        providerConfig.authType = 'oauth';
      } else {
        const apiKey = await prompt(rl, 'API Key (or env var like ${MY_API_KEY}): ');
        if (apiKey) {
          providerConfig.apiKey = apiKey;
        }
      }
    }

    rl.close();

    // Save provider to file
    saveProvider(providerKey, providerConfig);

    console.log(`\n✓ Provider "${providerKey}" added.`);
    console.log(`  Path: ${PROVIDERS_DIR}/${providerKey}.json`);

    if (template?.config.authType === 'oauth') {
      console.log(`\nTo authenticate, run:`);
      console.log(`  karl providers login ${providerKey}`);
    } else if (template?.envVar && !process.env[template.envVar] && providerConfig.apiKey?.includes('${')) {
      console.log(`\nSet the ${template.envVar} environment variable to authenticate.`);
    }

  } catch (error) {
    rl.close();
    throw error;
  }
}

/**
 * Remove a provider
 */
export async function removeProvider(providerKey: string) {
  if (!providerExists(providerKey)) {
    console.error(`Provider "${providerKey}" not found.`);
    process.exit(1);
  }

  // Check if any models use this provider
  const modelsUsingProvider = getModelsUsingProvider(providerKey);

  if (modelsUsingProvider.length > 0) {
    console.error(`Cannot remove provider "${providerKey}" - used by models:`);
    for (const alias of modelsUsingProvider) {
      console.error(`  - ${alias}`);
    }
    console.error('');
    console.error('Remove these models first with: karl models remove <alias>');
    process.exit(1);
  }

  deleteProvider(providerKey);

  // Also remove OAuth credentials if any
  const oauthKey = providerKey === 'claude-pro-max' ? 'anthropic' : providerKey;
  removeOAuthCredentials(oauthKey);

  console.log(`✓ Provider "${providerKey}" removed.`);
}

/**
 * Edit a provider (opens the provider file or config containing it)
 */
export async function editProvider(providerKey: string) {
  const filePath = join(PROVIDERS_DIR, `${providerKey}.json`);
  if (existsSync(filePath)) {
    openInEditor(filePath);
    return;
  }

  const projectPath = join(process.cwd(), '.karl.json');
  const projectConfig = readProjectConfig();
  const projectProviders = projectConfig.providers as Record<string, unknown> | undefined;
  if (projectProviders && Object.prototype.hasOwnProperty.call(projectProviders, providerKey)) {
    openInEditor(projectPath);
    return;
  }

  if (existsSync(GLOBAL_CONFIG_PATH)) {
    try {
      const globalConfig = JSON.parse(readFileSync(GLOBAL_CONFIG_PATH, 'utf-8')) as Record<string, unknown>;
      const globalProviders = globalConfig.providers as Record<string, unknown> | undefined;
      if (globalProviders && Object.prototype.hasOwnProperty.call(globalProviders, providerKey)) {
        openInEditor(GLOBAL_CONFIG_PATH);
        return;
      }
    } catch {
      // Ignore invalid global config
    }
  }

  console.error(`Provider "${providerKey}" not found.`);
  process.exit(1);
}

/**
 * Login to an OAuth provider
 */
export async function loginProvider(providerKey?: string) {
  const cwd = process.cwd();
  const config = await loadConfig(cwd);
  const providers = config.providers ?? {};

  // Find OAuth providers
  const oauthProviders = Object.entries(providers)
    .filter(([_, p]) => p.authType === 'oauth')
    .map(([key]) => key);

  if (oauthProviders.length === 0) {
    console.error('No OAuth providers configured.');
    console.error('');
    console.error('Add one with: karl providers add claude-pro-max');
    process.exit(1);
  }

  if (!providerKey) {
    if (oauthProviders.length === 1) {
      providerKey = oauthProviders[0];
    } else {
      console.log('OAuth providers:');
      oauthProviders.forEach((name, i) => {
        console.log(`  ${i + 1}. ${name}`);
      });

      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const input = await prompt(rl, 'Select provider [1]: ') || '1';
      rl.close();

      const index = parseInt(input, 10);
      if (index >= 1 && index <= oauthProviders.length) {
        providerKey = oauthProviders[index - 1];
      } else {
        console.error('Invalid selection.');
        process.exit(1);
      }
    }
  }

  const providerConfig = providers[providerKey];
  if (!providerConfig) {
    console.error(`Provider "${providerKey}" not found.`);
    process.exit(1);
  }

  if (providerConfig.authType !== 'oauth') {
    console.error(`Provider "${providerKey}" uses API key authentication, not OAuth.`);
    console.error('');
    const envVar = providerConfig.apiKey?.match(/\$\{(\w+)\}/)?.[1];
    if (envVar) {
      console.error(`Set the ${envVar} environment variable instead.`);
    }
    process.exit(1);
  }

  await runLoginFlow();
}

/**
 * Logout from an OAuth provider
 */
export async function logoutProvider(providerKey: string) {
  if (!providerExists(providerKey)) {
    console.error(`Provider "${providerKey}" not found.`);
    process.exit(1);
  }

  const oauthKey = providerKey === 'claude-pro-max' ? 'anthropic' : providerKey;
  removeOAuthCredentials(oauthKey);

  console.log(`✓ Logged out from "${providerKey}".`);
}

/**
 * Handle providers subcommands
 */
export async function handleProvidersCommand(args: string[]) {
  const [command, ...rest] = args;

  switch (command) {
    case 'list':
    case 'ls':
      await listProviders();
      break;

    case 'show':
    case 'info':
      if (rest.length === 0) {
        console.error('Usage: karl providers show <name>');
        process.exit(1);
      }
      await showProvider(rest[0]);
      break;

    case 'add':
    case 'new':
    case 'create':
      await addProvider(rest[0]);
      break;

    case 'remove':
    case 'rm':
    case 'delete':
      if (rest.length === 0) {
        console.error('Usage: karl providers remove <name>');
        process.exit(1);
      }
      await removeProvider(rest[0]);
      break;

    case 'edit':
      if (rest.length === 0) {
        console.error('Usage: karl providers edit <name>');
        process.exit(1);
      }
      await editProvider(rest[0]);
      break;

    case 'login':
      await loginProvider(rest[0]);
      break;

    case 'logout':
      if (rest.length === 0) {
        console.error('Usage: karl providers logout <name>');
        process.exit(1);
      }
      await logoutProvider(rest[0]);
      break;

    default:
      if (!command) {
        console.error('Usage: karl providers <command>');
        console.error('');
        console.error('Commands:');
        console.error('  list              List configured providers');
        console.error('  show <name>       Show provider details');
        console.error('  add [name]        Add a new provider');
        console.error('  remove <name>     Remove a provider');
        console.error('  edit <name>       Edit a provider file');
        console.error('  login [name]      Login to OAuth provider');
        console.error('  logout <name>     Logout from OAuth provider');
      } else {
        console.error(`Unknown providers command: ${command}`);
        console.error('Available commands: list, show, add, remove, edit, login, logout');
      }
      process.exit(1);
  }
}
