import { existsSync, readdirSync, readFileSync, writeFileSync, chmodSync, mkdirSync } from 'fs';
import { readFile } from 'fs/promises';
import path, { basename, join } from 'path';
import { homedir } from 'os';

export interface ModelConfig {
  provider: string;
  model: string;
  maxTokens?: number;
  contextLength?: number;
  description?: string;
}

export interface ProviderConfig {
  type: string;
  baseUrl?: string;
  apiKey?: string;
  authType?: 'api_key' | 'oauth';
  [key: string]: unknown;
}

export interface StackConfig {
  name?: string;
  extends?: string;
  model?: string;
  temperature?: number;
  timeout?: number;
  maxTokens?: number;
  skill?: string;
  context?: string;
  contextFile?: string;
  unrestricted?: boolean;
}

export interface KarlConfig {
  defaultModel: string;
  models: Record<string, ModelConfig>;
  providers: Record<string, ProviderConfig>;
  stacks?: Record<string, StackConfig>;
}

export interface CliOptions {
  model?: string;
  skill?: string;
  context?: string;
  contextFile?: string;
  unrestricted?: boolean;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface ResolvedModel {
  model: string;
  providerKey: string;
  providerConfig: ProviderConfig;
  maxTokens?: number;
  contextLength?: number;
}

export interface KarlContext {
  stackName: string;
  stackOptions: CliOptions;
  systemPrompt: string;
  resolvedModel: ResolvedModel;
  apiKey: string;
}

const DEFAULT_CONFIG: KarlConfig = {
  defaultModel: '',
  models: {},
  providers: {},
  stacks: {},
};

const BASE_GUARDRAILS = `You are a helpful coding assistant. Follow these guidelines:

- Only modify files within the current working directory unless explicitly asked otherwise
- Before running destructive commands (rm, overwrite, etc.), confirm the intent
- Prefer reading files before editing to understand context
- Keep changes minimal and focused on the task at hand`;

const CONTEXT_FILES = [
  'CLAUDE.md',
  'AGENTS.md',
  'COPILOT.md',
  '.cursorrules',
  path.join('.github', 'copilot-instructions.md'),
  path.join('.karl', 'context.md'),
];

export async function loadKarlContext(cwd: string): Promise<KarlContext> {
  const config = await loadConfig(cwd);
  const stack = await resolveStackForIvo(config, cwd);
  if (!stack) {
    throw new Error('No Karl stack found for suggestions.');
  }

  const stackName = stack.name ?? 'default';
  const stackOptions = mergeWithOptions(stack, {});
  const systemPrompt = await buildSystemPrompt({
    cwd,
    skill: stackOptions.skill,
    context: stackOptions.context,
    contextFile: stackOptions.contextFile,
    unrestricted: stackOptions.unrestricted,
  });
  const resolvedModel = resolveModel(config, stackOptions);
  const apiKey = await resolveApiKey(resolvedModel.providerKey, resolvedModel.providerConfig);

  return {
    stackName,
    stackOptions,
    systemPrompt,
    resolvedModel,
    apiKey,
  };
}

async function loadConfig(cwd: string): Promise<KarlConfig> {
  const globalPath = resolveHomePath('~/.config/karl/karl.json');
  const projectPath = path.join(cwd, '.karl.json');

  const globalConfig = await readConfigFile(globalPath);
  const projectConfig = await readConfigFile(projectPath);
  const models = loadModelsFromDir();
  const providers = expandEnvInObject(loadProvidersFromDir());

  let merged = deepMerge(DEFAULT_CONFIG, globalConfig ?? undefined);
  merged = deepMerge(merged, projectConfig ?? undefined);

  merged.models = { ...merged.models, ...models };
  merged.providers = { ...merged.providers, ...providers };

  return merged;
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

function loadModelsFromDir(): Record<string, ModelConfig> {
  const models: Record<string, ModelConfig> = {};
  const modelsDir = join(homedir(), '.config', 'karl', 'models');

  if (!existsSync(modelsDir)) {
    return models;
  }

  try {
    const entries = readdirSync(modelsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const alias = basename(entry.name, '.json');
      const filePath = join(modelsDir, entry.name);
      try {
        models[alias] = JSON.parse(readFileSync(filePath, 'utf-8'));
      } catch {
        // Skip invalid files
      }
    }
  } catch {
    // Ignore errors
  }

  return models;
}

function loadProvidersFromDir(): Record<string, ProviderConfig> {
  const providers: Record<string, ProviderConfig> = {};
  const providersDir = join(homedir(), '.config', 'karl', 'providers');

  if (!existsSync(providersDir)) {
    return providers;
  }

  try {
    const entries = readdirSync(providersDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const name = basename(entry.name, '.json');
      const filePath = join(providersDir, entry.name);
      try {
        providers[name] = JSON.parse(readFileSync(filePath, 'utf-8'));
      } catch {
        // Skip invalid files
      }
    }
  } catch {
    // Ignore errors
  }

  return providers;
}

async function resolveStackForIvo(config: KarlConfig, cwd: string): Promise<StackConfig | null> {
  const ivoStack = await loadStack('ivo', config, cwd);
  if (ivoStack) return ivoStack;
  return loadStack('default', config, cwd);
}

async function loadStack(
  name: string,
  config: KarlConfig,
  cwd: string,
  visited: Set<string> = new Set()
): Promise<StackConfig | null> {
  if (visited.has(name)) {
    throw new Error(`Circular stack inheritance detected: ${Array.from(visited).join(' -> ')} -> ${name}`);
  }
  visited.add(name);

  const raw = loadStackRaw(name, config, cwd);
  if (!raw) return null;

  if (!raw.extends) {
    return { ...raw, name };
  }

  const parent = await loadStack(raw.extends, config, cwd, visited);
  if (!parent) {
    throw new Error(`Parent stack "${raw.extends}" not found for "${name}"`);
  }

  const { extends: _ignored, ...child } = raw;
  return {
    ...parent,
    ...child,
    name,
  };
}

function loadStackRaw(name: string, config: KarlConfig, cwd: string): StackConfig | null {
  let stack: StackConfig | null = null;

  if (config.stacks?.[name]) {
    stack = { ...config.stacks[name] };
  }

  const globalPath = join(homedir(), '.config', 'karl', 'stacks', `${name}.json`);
  const projectPath = join(cwd, '.karl', 'stacks', `${name}.json`);

  if (existsSync(globalPath)) {
    try {
      stack = JSON.parse(readFileSync(globalPath, 'utf-8'));
    } catch {
      // Ignore invalid stack
    }
  }

  if (existsSync(projectPath)) {
    try {
      stack = JSON.parse(readFileSync(projectPath, 'utf-8'));
    } catch {
      // Ignore invalid stack
    }
  }

  return stack ? { ...stack, name } : null;
}

function mergeWithOptions(stack: StackConfig, options: CliOptions): CliOptions {
  return {
    model: stack.model,
    skill: stack.skill,
    context: stack.context,
    contextFile: stack.contextFile,
    unrestricted: stack.unrestricted,
    timeoutMs: stack.timeout,
    temperature: stack.temperature,
    maxTokens: stack.maxTokens,
    ...Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined)),
  };
}

function resolveModel(config: KarlConfig, options: CliOptions): ResolvedModel {
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
    maxTokens: modelConfig.maxTokens,
    contextLength: modelConfig.contextLength,
  };
}

async function buildSystemPrompt(params: {
  cwd: string;
  skill?: string;
  context?: string;
  contextFile?: string;
  unrestricted?: boolean;
}): Promise<string> {
  const parts: string[] = [];

  if (!params.unrestricted) {
    parts.push(BASE_GUARDRAILS);
  }

  const contextFiles = await loadContextFiles(params.cwd);
  parts.push(...contextFiles);

  if (params.skill) {
    const skillContent = await loadSkillPrompt(params.skill, params.cwd);
    if (skillContent) {
      parts.push(skillContent.trim());
    }
  }

  if (params.contextFile) {
    const resolvedPath = resolveHomePath(params.contextFile);
    const fullPath = path.isAbsolute(resolvedPath) ? resolvedPath : path.resolve(params.cwd, resolvedPath);
    const extra = await readTextIfExists(fullPath);
    if (extra) {
      parts.push(extra.trim());
    }
  }

  if (params.context) {
    parts.push(params.context.trim());
  }

  return parts.filter(Boolean).join('\n\n');
}

async function loadContextFiles(cwd: string): Promise<string[]> {
  const contents: string[] = [];
  for (const file of CONTEXT_FILES) {
    const content = await readTextIfExists(path.join(cwd, file));
    if (content) {
      contents.push(content.trim());
    }
  }
  return contents.filter(Boolean);
}

async function loadSkillPrompt(skillName: string, cwd: string): Promise<string | null> {
  const paths = [
    join(homedir(), '.config', 'karl', 'skills', skillName, 'SKILL.md'),
    join(cwd, '.karl', 'skills', skillName, 'SKILL.md'),
  ];

  for (const skillPath of paths) {
    if (!existsSync(skillPath)) continue;
    try {
      const content = readFileSync(skillPath, 'utf-8');
      const parsed = parseFrontmatter(content);
      const name = parsed.data.name;
      const description = parsed.data.description;
      if (name && description) {
        return `# ${name}\n\n${description}\n\n${parsed.content}`.trim();
      }
      return content.trim();
    } catch {
      // Ignore invalid skill
    }
  }

  return null;
}

function parseFrontmatter(content: string): { data: Record<string, string>; content: string } {
  if (!content.startsWith('---')) {
    return { data: {}, content };
  }

  const parts = content.split('---');
  if (parts.length < 3) {
    return { data: {}, content };
  }

  const yamlContent = parts[1].trim();
  const markdownContent = parts.slice(2).join('---').trim();
  const lines = yamlContent.split('\n');
  const data: Record<string, string> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed.includes(': ')) {
      const [key, ...valueParts] = trimmed.split(': ');
      let value = valueParts.join(': ').trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      data[key.trim()] = value;
    }
  }

  return { data, content: markdownContent };
}

async function resolveApiKey(providerKey: string, providerConfig: ProviderConfig): Promise<string> {
  if (providerConfig.authType === 'oauth') {
    const token = await getProviderOAuthToken(providerKey);
    if (!token) {
      throw new Error(`No OAuth credentials available for provider: ${providerKey}`);
    }
    return token;
  }

  const apiKey = providerConfig.apiKey;
  if (!apiKey || typeof apiKey !== 'string' || apiKey.includes('${')) {
    throw new Error(`No API key configured for provider: ${providerKey}`);
  }
  return apiKey;
}

interface OAuthCredentials {
  type: 'oauth';
  refresh: string;
  access: string;
  expires: number;
}

function getOAuthPath(): string {
  return resolveHomePath('~/.config/karl/oauth.json');
}

function loadOAuthCredentials(provider: string): OAuthCredentials | null {
  const filePath = getOAuthPath();
  if (existsSync(filePath)) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const storage = JSON.parse(content) as Record<string, OAuthCredentials>;
      if (storage[provider]) {
        return storage[provider];
      }
    } catch {
      // Ignore invalid storage
    }
  }

  const piOAuthPath = resolveHomePath('~/.pi/agent/oauth.json');
  if (existsSync(piOAuthPath)) {
    try {
      const content = readFileSync(piOAuthPath, 'utf-8');
      const storage = JSON.parse(content) as Record<string, OAuthCredentials>;
      if (storage[provider]) {
        return storage[provider];
      }
    } catch {
      // Ignore invalid storage
    }
  }

  return null;
}

function saveOAuthCredentials(provider: string, creds: OAuthCredentials): void {
  const filePath = getOAuthPath();
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    fsEnsureDir(dir);
  }
  let storage: Record<string, OAuthCredentials> = {};
  if (existsSync(filePath)) {
    try {
      storage = JSON.parse(readFileSync(filePath, 'utf-8'));
    } catch {
      storage = {};
    }
  }
  storage[provider] = creds;
  writeFileSync(filePath, JSON.stringify(storage, null, 2), 'utf-8');
  chmodSync(filePath, 0o600);
}

async function getProviderOAuthToken(provider: string): Promise<string | null> {
  const oauthProviderMap: Record<string, string> = {
    'claude-pro-max': 'anthropic',
  };

  const oauthProvider = oauthProviderMap[provider] || provider;
  if (oauthProvider === 'anthropic') {
    return getAnthropicAccessToken();
  }
  return null;
}

async function getAnthropicAccessToken(): Promise<string | null> {
  const creds = loadOAuthCredentials('anthropic');
  if (!creds) return null;

  if (Date.now() >= creds.expires) {
    try {
      const refreshed = await refreshAnthropicToken(creds.refresh);
      saveOAuthCredentials('anthropic', refreshed);
      return refreshed.access;
    } catch {
      return null;
    }
  }

  return creds.access;
}

async function refreshAnthropicToken(refreshToken: string): Promise<OAuthCredentials> {
  const tokenResponse = await fetch('https://console.anthropic.com/v1/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
      refresh_token: refreshToken,
    }),
  });

  if (!tokenResponse.ok) {
    const error = await tokenResponse.text();
    throw new Error(`OAuth token refresh failed: ${error}`);
  }

  const tokenData = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  const expiresAt = Date.now() + tokenData.expires_in * 1000 - 5 * 60 * 1000;

  return {
    type: 'oauth',
    refresh: tokenData.refresh_token,
    access: tokenData.access_token,
    expires: expiresAt,
  };
}

function fsEnsureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

async function readTextIfExists(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

function resolveHomePath(inputPath: string): string {
  if (inputPath === '~') {
    return homedir();
  }
  if (inputPath.startsWith('~/')) {
    return join(homedir(), inputPath.slice(2));
  }
  return inputPath;
}

function expandEnv(value: string): string {
  return value.replace(/\$\{([^}:]+)(?::-([^}]+))?\}/g, (_, name: string, fallback: string) => {
    const resolved = process.env[name];
    if (resolved === undefined || resolved === '') {
      return fallback ?? '';
    }
    return resolved;
  });
}

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

function deepMerge<T>(base: T, override?: Partial<T>): T {
  if (override === undefined || override === null) {
    return base;
  }
  if (Array.isArray(base) || Array.isArray(override)) {
    return (override as T) ?? base;
  }
  if (typeof base === 'object' && typeof override === 'object') {
    const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const [key, value] of Object.entries(override)) {
      const baseValue = (base as Record<string, unknown>)[key];
      if (value === undefined) {
        continue;
      }
      if (
        typeof baseValue === 'object' &&
        baseValue !== null &&
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value)
      ) {
        result[key] = deepMerge(baseValue, value as Record<string, unknown>);
      } else {
        result[key] = value as unknown;
      }
    }
    return result as T;
  }
  return override as T;
}
