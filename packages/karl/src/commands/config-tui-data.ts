import path from 'path';
import { existsSync, readFileSync } from 'fs';
import { loadConfig } from '../config.js';
import { StackManager } from '../stacks.js';
import { readTextIfExists, resolveHomePath } from '../utils.js';
import { modelExists } from './models.js';
import { providerExists } from './providers.js';
import { CODEX_PROVIDER_KEY, getCodexProviderStatus, isCodexProvider } from '../codex-provider.js';
import { getOAuthStorageKey, isOAuthCredentialsExpired, loadOAuthCredentials } from '../oauth.js';
import type { KarlConfig, ModelConfig, ProviderConfig, StackConfig } from '../types.js';

const GLOBAL_CONFIG_PATH = resolveHomePath('~/.config/karl/karl.json');
const GLOBAL_MODELS_DIR = resolveHomePath('~/.config/karl/models');
const GLOBAL_PROVIDERS_DIR = resolveHomePath('~/.config/karl/providers');
const GLOBAL_STACKS_DIR = resolveHomePath('~/.config/karl/stacks');

export type ConfigCategoryId = 'common' | 'models' | 'providers' | 'stacks' | 'runtime' | 'files';
export type ConfigSource = 'builtin' | 'file' | 'inline-global' | 'inline-project' | 'inline-unknown';

export interface ConfigModelEntry {
  alias: string;
  config: ModelConfig;
  isDefault: boolean;
  source: ConfigSource;
}

export interface ConfigProviderEntry {
  key: string;
  config: ProviderConfig;
  source: ConfigSource;
  auth: string;
}

export interface ConfigStackEntry {
  name: string;
  path?: string;
  source: ConfigSource;
  raw?: StackConfig;
  resolved?: StackConfig;
}

export interface ConfigTuiData {
  config: KarlConfig;
  globalConfig: Partial<KarlConfig> | null;
  projectConfig: Partial<KarlConfig> | null;
  models: ConfigModelEntry[];
  providers: ConfigProviderEntry[];
  stacks: ConfigStackEntry[];
  paths: {
    globalPath: string;
    projectPath: string;
    globalExists: boolean;
    projectExists: boolean;
    modelsDir: string;
    providersDir: string;
    stacksGlobalDir: string;
    stacksProjectDir: string;
  };
}

export interface ConfigAction {
  id: string;
  name: string;
  description: string;
  shortcut?: string;
}

export const CONFIG_CATEGORIES: Array<{ id: ConfigCategoryId; name: string }> = [
  { id: 'common', name: 'Common changes' },
  { id: 'models', name: 'Models' },
  { id: 'providers', name: 'Providers' },
  { id: 'stacks', name: 'Stacks' },
  { id: 'runtime', name: 'Runtime' },
  { id: 'files', name: 'Files' },
];

async function readConfigFile(filePath: string): Promise<Partial<KarlConfig> | null> {
  const content = await readTextIfExists(filePath);
  if (!content) return null;
  try {
    return JSON.parse(content) as Partial<KarlConfig>;
  } catch {
    return null;
  }
}

function readStackFile(filePath: string): StackConfig | undefined {
  if (!existsSync(filePath)) return undefined;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as StackConfig;
  } catch {
    return undefined;
  }
}

function sourceForInlineKey(
  key: string,
  globalConfig: Partial<KarlConfig> | null,
  projectConfig: Partial<KarlConfig> | null,
  field: 'models' | 'providers' | 'stacks'
): ConfigSource {
  const projectValues = projectConfig?.[field] as Record<string, unknown> | undefined;
  if (projectValues && Object.prototype.hasOwnProperty.call(projectValues, key)) return 'inline-project';
  const globalValues = globalConfig?.[field] as Record<string, unknown> | undefined;
  if (globalValues && Object.prototype.hasOwnProperty.call(globalValues, key)) return 'inline-global';
  return 'inline-unknown';
}

function providerAuth(key: string, provider: ProviderConfig): string {
  if (isCodexProvider(provider)) return `Codex CLI · ${getCodexProviderStatus().detail}`;
  if (provider.authType === 'oauth') {
    const credentials = loadOAuthCredentials(getOAuthStorageKey(key));
    if (credentials && isOAuthCredentialsExpired(credentials)) return 'OAuth · refresh needed';
    return credentials ? 'OAuth · logged in' : 'OAuth · not logged in';
  }
  if (!provider.apiKey) return 'API key · missing';
  const variable = provider.apiKey.match(/\$\{(\w+)\}/)?.[1];
  if (!variable) return 'API key · set';
  return process.env[variable] ? `$${variable} · set` : `$${variable} · missing`;
}

export async function loadConfigTuiData(cwd: string): Promise<ConfigTuiData> {
  const config = await loadConfig(cwd);
  const projectPath = path.join(cwd, '.karl.json');
  const stacksProjectDir = path.join(cwd, '.karl', 'stacks');
  const [globalConfig, projectConfig] = await Promise.all([
    readConfigFile(GLOBAL_CONFIG_PATH),
    readConfigFile(projectPath),
  ]);

  const models = Object.entries(config.models ?? {}).map(([alias, model]) => ({
    alias,
    config: model,
    isDefault: alias === config.defaultModel,
    source: modelExists(alias) ? 'file' : sourceForInlineKey(alias, globalConfig, projectConfig, 'models'),
  })).sort((a, b) => a.alias.localeCompare(b.alias));

  const providers = Object.entries(config.providers ?? {}).map(([key, provider]) => ({
    key,
    config: provider,
    source: key === CODEX_PROVIDER_KEY
      ? 'builtin' as const
      : providerExists(key)
        ? 'file' as const
        : sourceForInlineKey(key, globalConfig, projectConfig, 'providers'),
    auth: providerAuth(key, provider),
  })).sort((a, b) => a.key.localeCompare(b.key));

  const manager = new StackManager(config);
  const listedStacks = await manager.listStacks();
  const stacks = await Promise.all(listedStacks.map(async stack => {
    const projectFile = path.join(stacksProjectDir, `${stack.name}.json`);
    const globalFile = path.join(GLOBAL_STACKS_DIR, `${stack.name}.json`);
    const filePath = existsSync(projectFile) ? projectFile : existsSync(globalFile) ? globalFile : undefined;
    const source = filePath
      ? 'file' as const
      : sourceForInlineKey(stack.name, globalConfig, projectConfig, 'stacks');
    const inlineValues = source === 'inline-project' ? projectConfig?.stacks : globalConfig?.stacks;
    return {
      name: stack.name,
      path: filePath ?? stack.path,
      source,
      raw: filePath
        ? readStackFile(filePath)
        : (inlineValues?.[stack.name] as StackConfig | undefined),
      resolved: await manager.getStack(stack.name) ?? undefined,
    } satisfies ConfigStackEntry;
  }));
  stacks.sort((a, b) => a.name.localeCompare(b.name));

  return {
    config,
    globalConfig,
    projectConfig,
    models,
    providers,
    stacks,
    paths: {
      globalPath: GLOBAL_CONFIG_PATH,
      projectPath,
      globalExists: existsSync(GLOBAL_CONFIG_PATH),
      projectExists: existsSync(projectPath),
      modelsDir: GLOBAL_MODELS_DIR,
      providersDir: GLOBAL_PROVIDERS_DIR,
      stacksGlobalDir: GLOBAL_STACKS_DIR,
      stacksProjectDir,
    },
  };
}

function sourceLabel(source: ConfigSource): string {
  if (source === 'builtin') return 'built in';
  if (source === 'inline-global') return 'global config';
  if (source === 'inline-project') return 'project config';
  if (source === 'inline-unknown') return 'merged config';
  return 'file';
}

function runtimeActions(data: ConfigTuiData): ConfigAction[] {
  const tools = data.config.tools?.enabled?.join(', ') || 'none';
  const history = data.config.history?.enabled === false ? 'disabled' : 'enabled';
  return [
    { id: 'runtime:default', name: 'Default model', description: data.config.defaultModel || 'not set' },
    { id: 'runtime:tools', name: 'Enabled tools', description: tools },
    { id: 'runtime:retry', name: 'Retry policy', description: `${data.config.retry.attempts} attempts · ${data.config.retry.backoff}` },
    { id: 'runtime:history', name: 'Run history', description: history },
    { id: 'runtime:edit-global', name: 'Edit global runtime settings', description: data.paths.globalPath, shortcut: 'g' },
    { id: 'runtime:edit-project', name: 'Edit project runtime settings', description: data.paths.projectPath, shortcut: 'p' },
  ];
}

export function getConfigActions(data: ConfigTuiData, category: ConfigCategoryId): ConfigAction[] {
  switch (category) {
    case 'common':
      return [
        { id: 'common:default', name: 'Switch the default model', description: `Currently ${data.config.defaultModel || 'not set'}`, shortcut: 's' },
        { id: 'common:add-model', name: 'Add a model', description: 'Make another model available to runs and stacks', shortcut: 'm' },
        { id: 'common:add-provider', name: 'Connect a provider', description: 'Codex, OpenRouter, Wafer, or a custom endpoint', shortcut: 'p' },
        { id: 'common:add-stack', name: 'Build a stack', description: 'Give a model and policy a memorable command', shortcut: 'n' },
        { id: 'common:doctor', name: 'Inspect configuration health', description: 'Sources, authentication, and broken references', shortcut: 'd' },
      ];
    case 'models':
      return [
        { id: 'models:add', name: 'Add model', description: 'Create a model definition', shortcut: 'a' },
        ...data.models.map(model => ({
          id: `model:${model.alias}`,
          name: `${model.isDefault ? '● ' : ''}${model.alias}`,
          description: `${model.config.provider}/${model.config.model} · ${sourceLabel(model.source)}`,
        })),
      ];
    case 'providers':
      return [
        { id: 'providers:add', name: 'Connect provider', description: 'Add credentials or a compatible endpoint', shortcut: 'a' },
        ...data.providers.map(provider => ({
          id: `provider:${provider.key}`,
          name: provider.key,
          description: `${provider.auth} · ${sourceLabel(provider.source)}`,
        })),
      ];
    case 'stacks':
      return [
        { id: 'stacks:add', name: 'Create stack', description: 'Bundle a model, skills, tools, and policy', shortcut: 'a' },
        ...data.stacks.map(stack => ({
          id: `stack:${stack.name}`,
          name: stack.name,
          description: `${stack.resolved?.model || 'no model'} · ${sourceLabel(stack.source)}`,
        })),
      ];
    case 'runtime':
      return runtimeActions(data);
    case 'files':
      return [
        { id: 'files:global', name: 'Global configuration', description: `${data.paths.globalPath} · ${data.paths.globalExists ? 'present' : 'not created'}`, shortcut: 'g' },
        { id: 'files:project', name: 'Project configuration', description: `${data.paths.projectPath} · ${data.paths.projectExists ? 'present' : 'not created'}`, shortcut: 'p' },
        { id: 'files:models', name: 'Model definitions', description: data.paths.modelsDir },
        { id: 'files:providers', name: 'Provider definitions', description: data.paths.providersDir },
        { id: 'files:stacks-global', name: 'Global stacks', description: data.paths.stacksGlobalDir },
        { id: 'files:stacks-project', name: 'Project stacks', description: data.paths.stacksProjectDir },
      ];
  }
}

export function filterConfigActions(actions: ConfigAction[], query: string): ConfigAction[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return actions;
  return actions.filter(action => `${action.name}\n${action.description}`.toLowerCase().includes(normalized));
}
