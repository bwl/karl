import path from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { createInterface, emitKeypressEvents } from 'readline';
import { loadConfig } from '../config.js';
import { StackManager } from '../stacks.js';
import { readTextIfExists, resolveHomePath, formatError } from '../utils.js';
import { createDefaultBackend } from '../config-backend.js';
import { modelExists } from './models.js';
import { providerExists } from './providers.js';
import { applyOverlay, renderOverlay, updateOverlay } from '../tui/overlays.js';
import type { OverlayState, OverlayCommand, PickerItem } from '../tui/overlays.js';
import { padRight, truncateLine, wrapText } from '../tui/text.js';
import { loadOAuthCredentials } from '../oauth.js';
import { skillManager } from '../skills.js';
import type { KarlConfig, ModelConfig, ProviderConfig, StackConfig } from '../types.js';

const GLOBAL_CONFIG_PATH = resolveHomePath('~/.config/karl/karl.json');
const GLOBAL_MODELS_DIR = resolveHomePath('~/.config/karl/models');
const GLOBAL_PROVIDERS_DIR = resolveHomePath('~/.config/karl/providers');
const GLOBAL_STACKS_DIR = resolveHomePath('~/.config/karl/stacks');

type SectionId = 'overview' | 'models' | 'providers' | 'stacks' | 'tools' | 'retry' | 'history' | 'agent' | 'files';
type ConfigSource = 'file' | 'inline-global' | 'inline-project' | 'inline-unknown';

interface ModelEntry {
  alias: string;
  config: ModelConfig;
  isDefault: boolean;
  source: ConfigSource;
}

interface ProviderEntry {
  key: string;
  config: ProviderConfig;
  source: ConfigSource;
}

interface StackEntry {
  name: string;
  model?: string;
  skill?: string;
  extends?: string;
  path?: string;
  source: ConfigSource;
  resolved?: StackConfig;
  raw?: StackConfig;
}

interface TuiPaths {
  globalPath: string;
  projectPath: string;
  globalExists: boolean;
  projectExists: boolean;
  modelsDir: string;
  providersDir: string;
  stacksGlobalDir: string;
  stacksProjectDir: string;
}

interface TuiData {
  config: KarlConfig;
  globalConfig: Partial<KarlConfig> | null;
  projectConfig: Partial<KarlConfig> | null;
  models: ModelEntry[];
  providers: ProviderEntry[];
  stacks: StackEntry[];
  paths: TuiPaths;
}

interface Section {
  id: SectionId;
  label: string;
  type: 'list' | 'detail';
}

type TuiMode = 'main' | 'stack-edit';

interface StackEditState {
  name: string;
  fieldIndex: number;
}

type StackFieldId =
  | 'extends'
  | 'model'
  | 'skill'
  | 'temperature'
  | 'timeout'
  | 'maxTokens'
  | 'tools'
  | 'unrestricted'
  | 'contextFile'
  | 'context';

interface StackEditField {
  id: StackFieldId;
  label: string;
  value: string;
  description: string;
}

interface TuiState {
  sectionIndex: number;
  itemIndexBySection: Partial<Record<SectionId, number>>;
  busy: boolean;
  overlay?: OverlayState;
  mode: TuiMode;
  stackEdit?: StackEditState;
}

async function readConfigFileSafe(filePath: string): Promise<Partial<KarlConfig> | null> {
  const content = await readTextIfExists(filePath);
  if (!content) {
    return null;
  }
  try {
    return JSON.parse(content) as Partial<KarlConfig>;
  } catch {
    return null;
  }
}

function readConfigFileStrict(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) {
    return {};
  }
  const content = readFileSync(filePath, 'utf-8');
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Invalid config JSON at ${filePath}: ${(error as Error).message}`);
  }
}

function writeConfigFile(filePath: string, data: Record<string, unknown>): void {
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

function asStackConfig(value: unknown): StackConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as StackConfig;
}

function readStackConfigSafe(filePath: string): StackConfig | null {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const content = readFileSync(filePath, 'utf-8');
    return asStackConfig(JSON.parse(content));
  } catch {
    return null;
  }
}

function parseBoolean(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  throw new Error(`Invalid boolean: "${value}" (use true/false)`);
}

function parseDurationInput(input: string): number {
  const match = input.trim().match(/^(\d+)(ms|s|m|h)?$/);
  if (!match) {
    throw new Error('Use format like 10s, 5m, 1h, or 30000 (ms)');
  }
  const value = parseInt(match[1], 10);
  const unit = match[2] || 'ms';
  switch (unit) {
    case 'ms':
      return value;
    case 's':
      return value * 1000;
    case 'm':
      return value * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    default:
      return value;
  }
}

function formatDuration(ms: number): string {
  if (ms >= 60 * 60 * 1000) {
    return `${ms / (60 * 60 * 1000)}h`;
  }
  if (ms >= 60 * 1000) {
    return `${ms / (60 * 1000)}m`;
  }
  if (ms >= 1000) {
    return `${ms / 1000}s`;
  }
  return `${ms}ms`;
}

function parseList(value: string): string[] {
  if (value.trim().toLowerCase() === 'none') {
    return [];
  }
  return value.split(',').map(entry => entry.trim()).filter(Boolean);
}

function getConfigPaths(cwd: string): TuiPaths {
  const projectPath = getProjectConfigPath(cwd);
  return {
    globalPath: GLOBAL_CONFIG_PATH,
    projectPath,
    globalExists: existsSync(GLOBAL_CONFIG_PATH),
    projectExists: existsSync(projectPath),
    modelsDir: GLOBAL_MODELS_DIR,
    providersDir: GLOBAL_PROVIDERS_DIR,
    stacksGlobalDir: GLOBAL_STACKS_DIR,
    stacksProjectDir: path.join(cwd, '.karl', 'stacks'),
  };
}

type ConfigScope = 'global' | 'project';

type ConfigClearField =
  | 'defaultModel'
  | 'tools.enabled'
  | 'tools.custom'
  | 'retry.attempts'
  | 'retry.backoff'
  | 'history.enabled'
  | 'history.path'
  | 'history.maxDiffBytes'
  | 'history.maxDiffLines'
  | 'agent.model'
  | 'agent.provider';

interface ConfigUpdateInput {
  defaultModel?: string;
  toolsEnabled?: string[];
  toolsCustom?: string[];
  retryAttempts?: number;
  retryBackoff?: 'exponential' | 'linear';
  historyEnabled?: boolean;
  historyPath?: string;
  historyMaxDiffBytes?: number;
  historyMaxDiffLines?: number;
  agentModel?: string;
  agentProvider?: string;
}

function normalizeConfigClearField(field: string): ConfigClearField | null {
  const map: Record<string, ConfigClearField> = {
    'default-model': 'defaultModel',
    defaultModel: 'defaultModel',
    'tools.enabled': 'tools.enabled',
    'tools.custom': 'tools.custom',
    'retry.attempts': 'retry.attempts',
    'retry.backoff': 'retry.backoff',
    'history.enabled': 'history.enabled',
    'history.path': 'history.path',
    'history.max-diff-bytes': 'history.maxDiffBytes',
    'history.max-diff-lines': 'history.maxDiffLines',
    'agent.model': 'agent.model',
    'agent.provider': 'agent.provider',
  };
  return map[field] ?? null;
}

function removeEmptyObject(parent: Record<string, unknown>, key: string): void {
  const value = parent[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return;
  }
  if (Object.keys(value as Record<string, unknown>).length === 0) {
    delete parent[key];
  }
}

function applyConfigUpdates(
  config: Record<string, unknown>,
  updates: ConfigUpdateInput,
  clearFields: Set<ConfigClearField>
): Record<string, unknown> {
  const next = { ...config } as Record<string, any>;

  if (updates.defaultModel !== undefined) {
    next.defaultModel = updates.defaultModel;
  }

  if (updates.toolsEnabled !== undefined || updates.toolsCustom !== undefined) {
    const tools = { ...(next.tools ?? {}) };
    if (updates.toolsEnabled !== undefined) tools.enabled = updates.toolsEnabled;
    if (updates.toolsCustom !== undefined) tools.custom = updates.toolsCustom;
    next.tools = tools;
  }

  if (updates.retryAttempts !== undefined || updates.retryBackoff !== undefined) {
    const retry = { ...(next.retry ?? {}) };
    if (updates.retryAttempts !== undefined) retry.attempts = updates.retryAttempts;
    if (updates.retryBackoff !== undefined) retry.backoff = updates.retryBackoff;
    next.retry = retry;
  }

  if (
    updates.historyEnabled !== undefined ||
    updates.historyPath !== undefined ||
    updates.historyMaxDiffBytes !== undefined ||
    updates.historyMaxDiffLines !== undefined
  ) {
    const history = { ...(next.history ?? {}) };
    if (updates.historyEnabled !== undefined) history.enabled = updates.historyEnabled;
    if (updates.historyPath !== undefined) history.path = updates.historyPath;
    if (updates.historyMaxDiffBytes !== undefined) history.maxDiffBytes = updates.historyMaxDiffBytes;
    if (updates.historyMaxDiffLines !== undefined) history.maxDiffLines = updates.historyMaxDiffLines;
    next.history = history;
  }

  if (updates.agentModel !== undefined || updates.agentProvider !== undefined) {
    const agent = { ...(next.agent ?? {}) };
    if (updates.agentModel !== undefined) agent.model = updates.agentModel;
    if (updates.agentProvider !== undefined) agent.provider = updates.agentProvider;
    next.agent = agent;
  }

  for (const field of clearFields) {
    switch (field) {
      case 'defaultModel':
        delete next.defaultModel;
        break;
      case 'tools.enabled':
        if (next.tools) delete next.tools.enabled;
        break;
      case 'tools.custom':
        if (next.tools) delete next.tools.custom;
        break;
      case 'retry.attempts':
        if (next.retry) delete next.retry.attempts;
        break;
      case 'retry.backoff':
        if (next.retry) delete next.retry.backoff;
        break;
      case 'history.enabled':
        if (next.history) delete next.history.enabled;
        break;
      case 'history.path':
        if (next.history) delete next.history.path;
        break;
      case 'history.maxDiffBytes':
        if (next.history) delete next.history.maxDiffBytes;
        break;
      case 'history.maxDiffLines':
        if (next.history) delete next.history.maxDiffLines;
        break;
      case 'agent.model':
        if (next.agent) delete next.agent.model;
        break;
      case 'agent.provider':
        if (next.agent) delete next.agent.provider;
        break;
    }
  }

  removeEmptyObject(next, 'tools');
  removeEmptyObject(next, 'retry');
  removeEmptyObject(next, 'history');
  removeEmptyObject(next, 'agent');

  return next;
}

function getProjectConfigPath(cwd: string): string {
  return path.join(cwd, '.karl.json');
}

function getSourceForInlineKey<T extends Record<string, unknown>>(
  key: string,
  globalConfig: Partial<KarlConfig> | null,
  projectConfig: Partial<KarlConfig> | null,
  field: 'models' | 'providers' | 'stacks'
): ConfigSource {
  const projectField = projectConfig?.[field] as T | undefined;
  if (projectField && Object.prototype.hasOwnProperty.call(projectField, key)) {
    return 'inline-project';
  }
  const globalField = globalConfig?.[field] as T | undefined;
  if (globalField && Object.prototype.hasOwnProperty.call(globalField, key)) {
    return 'inline-global';
  }
  return 'inline-unknown';
}

function formatSourceLabel(source: ConfigSource): string {
  switch (source) {
    case 'file':
      return 'file';
    case 'inline-project':
      return 'inline (project)';
    case 'inline-global':
      return 'inline (global)';
    default:
      return 'inline (unknown)';
  }
}

function ensureDirForFile(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
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

function hasEditor(): boolean {
  return !!(process.env.EDITOR || process.env.VISUAL);
}

async function waitForEnter(message = 'Press Enter to return to the config UI...'): Promise<void> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  await new Promise<void>((resolve) => {
    rl.question(message, () => {
      rl.close();
      resolve();
    });
  });
}

function formatValue(value: unknown, fallback = '(none)'): string {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value);
}

function formatStackValue<T>(
  base: T | undefined,
  resolved: T | undefined,
  formatter: (value: T) => string,
  emptyLabel = '(unset)'
): string {
  if (base !== undefined && base !== null) {
    return formatter(base);
  }
  if (resolved !== undefined && resolved !== null) {
    return `inherit: ${formatter(resolved)}`;
  }
  return emptyLabel;
}

function formatStackString(value: string): string {
  if (!value) return '(empty)';
  return value;
}

function formatStackList(value: string[]): string {
  if (!value || value.length === 0) return 'none';
  return value.join(', ');
}

function formatStackBoolean(value: boolean): string {
  return value ? 'true' : 'false';
}

function formatStackNumber(value: number): string {
  return `${value}`;
}

function formatStackContext(value: string): string {
  if (!value || value.trim().length === 0) return '(empty)';
  return `set (${value.length} chars)`;
}


function formatField(label: string, value: string, width: number): string[] {
  const prefix = `${label}: `;
  if (width <= prefix.length) {
    return [truncateLine(prefix + value, width)];
  }
  const wrapped = wrapText(value, width - prefix.length);
  const lines = [`${prefix}${wrapped[0]}`];
  for (const line of wrapped.slice(1)) {
    lines.push(`${' '.repeat(prefix.length)}${line}`);
  }
  return lines;
}

function formatPrice(value?: number): string {
  if (value === undefined) return '(none)';
  if (value >= 1) return `$${value.toFixed(2)}/1M`;
  return `$${value.toFixed(4)}/1M`;
}

function formatProviderAuth(key: string, provider: ProviderConfig): string {
  if (provider.authType === 'oauth') {
    const oauthKey = key === 'claude-pro-max' ? 'anthropic' : key;
    const creds = loadOAuthCredentials(oauthKey);
    return creds ? 'oauth (logged in)' : 'oauth (not logged in)';
  }

  const apiKey = provider.apiKey;
  if (!apiKey) return 'api key (missing)';
  if (!apiKey.includes('${')) return 'api key (set)';

  const envVar = apiKey.match(/\$\{(\w+)\}/)?.[1];
  if (!envVar) return 'api key (env)';
  return process.env[envVar] ? `api key ($${envVar} set)` : `api key ($${envVar} missing)`;
}

async function loadTuiData(cwd: string): Promise<TuiData> {
  const config = await loadConfig(cwd);
  const projectPath = getProjectConfigPath(cwd);
  const stacksProjectDir = path.join(cwd, '.karl', 'stacks');
  const stacksGlobalDir = GLOBAL_STACKS_DIR;
  const [globalConfig, projectConfig] = await Promise.all([
    readConfigFileSafe(GLOBAL_CONFIG_PATH),
    readConfigFileSafe(projectPath)
  ]);

  const models = Object.entries(config.models ?? {}).map(([alias, model]) => ({
    alias,
    config: model,
    isDefault: alias === config.defaultModel,
    source: modelExists(alias) ? 'file' : getSourceForInlineKey(alias, globalConfig, projectConfig, 'models'),
  })).sort((a, b) => a.alias.localeCompare(b.alias));

  const providers = Object.entries(config.providers ?? {}).map(([key, provider]) => ({
    key,
    config: provider,
    source: providerExists(key) ? 'file' : getSourceForInlineKey(key, globalConfig, projectConfig, 'providers'),
  })).sort((a, b) => a.key.localeCompare(b.key));

  const manager = new StackManager(config);
  const stacks = await manager.listStacks();
  const stackSources = new Map<string, ConfigSource>();
  if (globalConfig?.stacks) {
    for (const name of Object.keys(globalConfig.stacks)) {
      stackSources.set(name, 'inline-global');
    }
  }
  if (projectConfig?.stacks) {
    for (const name of Object.keys(projectConfig.stacks)) {
      stackSources.set(name, 'inline-project');
    }
  }

  const resolvedStacks = new Map<string, StackConfig>();
  await Promise.all(stacks.map(async (stack) => {
    const resolved = await manager.getStack(stack.name);
    if (resolved) {
      resolvedStacks.set(stack.name, resolved);
    }
  }));

  const resolveStackFilePath = (name: string): string | null => {
    const projectStackPath = path.join(stacksProjectDir, `${name}.json`);
    if (existsSync(projectStackPath)) {
      return projectStackPath;
    }
    const globalStackPath = path.join(stacksGlobalDir, `${name}.json`);
    if (existsSync(globalStackPath)) {
      return globalStackPath;
    }
    return null;
  };

  const stackEntries = stacks.map((stack) => {
    const filePath = resolveStackFilePath(stack.name);
    if (filePath) {
      const raw = readStackConfigSafe(filePath);
      return {
        name: stack.name,
        model: raw ? raw.model : stack.model,
        skill: raw ? raw.skill : stack.skill,
        extends: raw ? raw.extends : stack.extends,
        path: filePath,
        source: 'file',
        raw: raw ?? undefined,
        resolved: resolvedStacks.get(stack.name),
      } satisfies StackEntry;
    }

    const source = stackSources.get(stack.name) ?? 'inline-unknown';
    const inlineStacks = source === 'inline-project' ? projectConfig?.stacks : globalConfig?.stacks;
    const raw = asStackConfig(inlineStacks?.[stack.name]);
    return {
      name: stack.name,
      model: raw ? raw.model : stack.model,
      skill: raw ? raw.skill : stack.skill,
      extends: raw ? raw.extends : stack.extends,
      path: stack.path,
      source,
      raw: raw ?? undefined,
      resolved: resolvedStacks.get(stack.name),
    } satisfies StackEntry;
  }).sort((a, b) => a.name.localeCompare(b.name));

  return {
    config,
    globalConfig,
    projectConfig,
    models,
    providers,
    stacks: stackEntries,
    paths: {
      globalPath: GLOBAL_CONFIG_PATH,
      projectPath,
      globalExists: existsSync(GLOBAL_CONFIG_PATH),
      projectExists: existsSync(projectPath),
      modelsDir: GLOBAL_MODELS_DIR,
      providersDir: GLOBAL_PROVIDERS_DIR,
      stacksGlobalDir,
      stacksProjectDir,
    },
  };
}

function getSectionLabel(section: Section, data: TuiData): string {
  switch (section.id) {
    case 'models':
      return `${section.label} (${data.models.length})`;
    case 'providers':
      return `${section.label} (${data.providers.length})`;
    case 'stacks':
      return `${section.label} (${data.stacks.length})`;
    default:
      return section.label;
  }
}

function renderListSection<T>(
  title: string,
  items: T[],
  selectedIndex: number,
  width: number,
  height: number,
  formatRow: (item: T) => string,
  formatDetails: (item: T) => string[]
): string[] {
  const lines: string[] = [title];
  if (items.length === 0) {
    lines.push('(none)');
    return lines.slice(0, height);
  }

  const listCap = Math.max(1, Math.min(items.length + 1, Math.floor(height * 0.6)));
  const listHeight = Math.max(1, Math.min(height, listCap));
  const detailHeight = Math.max(0, height - listHeight - 1);
  const windowSize = Math.max(1, listHeight - 1);
  let start = 0;
  if (items.length > windowSize) {
    start = Math.max(0, selectedIndex - Math.floor(windowSize / 2));
    if (start + windowSize > items.length) {
      start = items.length - windowSize;
    }
  }
  const end = Math.min(items.length, start + windowSize);

  for (let i = start; i < end; i++) {
    const prefix = i === selectedIndex ? '> ' : '  ';
    const row = truncateLine(`${prefix}${formatRow(items[i])}`, width);
    lines.push(row);
  }

  while (lines.length < listHeight) {
    lines.push('');
  }

  if (detailHeight > 0) {
    lines.push('');
    const details = formatDetails(items[selectedIndex]);
    for (const line of details.slice(0, detailHeight)) {
      lines.push(truncateLine(line, width));
    }
  }

  return lines.slice(0, height);
}

function renderOverview(data: TuiData, width: number, height: number): string[] {
  const lines: string[] = [];
  lines.push('Overview');
  lines.push(...formatField('Default model', formatValue(data.config.defaultModel), width));
  lines.push(...formatField('Models', `${data.models.length}`, width));
  lines.push(...formatField('Providers', `${data.providers.length}`, width));
  lines.push(...formatField('Stacks', `${data.stacks.length}`, width));

  const toolsEnabled = data.config.tools?.enabled?.join(', ') || '(none)';
  lines.push(...formatField('Tools enabled', toolsEnabled, width));

  const historyEnabled = data.config.history?.enabled !== false ? 'enabled' : 'disabled';
  lines.push(...formatField('History', historyEnabled, width));
  lines.push(...formatField('Retry', `${data.config.retry.attempts} (${data.config.retry.backoff})`, width));

  const agentModel = data.config.agent?.model ? data.config.agent?.model : '(none)';
  lines.push(...formatField('Agent model', agentModel, width));

  lines.push('');
  lines.push('Config files');
  lines.push(...formatField('Global', data.paths.globalPath, width));
  lines.push(...formatField('Project', data.paths.projectPath, width));

  return lines.slice(0, height);
}

function renderTools(data: TuiData, width: number, height: number): string[] {
  const lines: string[] = [];
  lines.push('Tools');
  const enabled = data.config.tools?.enabled?.join(', ') || '(none)';
  const custom = data.config.tools?.custom?.join(', ') || '(none)';
  lines.push(...formatField('Enabled', enabled, width));
  lines.push(...formatField('Custom', custom, width));
  return lines.slice(0, height);
}

function renderRetry(data: TuiData, width: number, height: number): string[] {
  const lines: string[] = [];
  lines.push('Retry');
  lines.push(...formatField('Attempts', `${data.config.retry.attempts}`, width));
  lines.push(...formatField('Backoff', data.config.retry.backoff, width));
  return lines.slice(0, height);
}

function renderHistory(data: TuiData, width: number, height: number): string[] {
  const history = data.config.history ?? {};
  const lines: string[] = [];
  lines.push('History');
  lines.push(...formatField('Enabled', history.enabled === false ? 'false' : 'true', width));
  lines.push(...formatField('Path', formatValue(history.path), width));
  lines.push(...formatField('Max diff bytes', formatValue(history.maxDiffBytes), width));
  lines.push(...formatField('Max diff lines', formatValue(history.maxDiffLines), width));
  return lines.slice(0, height);
}

function renderAgent(data: TuiData, width: number, height: number): string[] {
  const lines: string[] = [];
  lines.push('Agent');
  lines.push(...formatField('Model', formatValue(data.config.agent?.model), width));
  lines.push(...formatField('Provider', formatValue(data.config.agent?.provider), width));
  return lines.slice(0, height);
}

function renderFiles(data: TuiData, width: number, height: number): string[] {
  const lines: string[] = [];
  lines.push('Files');
  lines.push(...formatField('Global config', `${data.paths.globalPath} (${data.paths.globalExists ? 'exists' : 'missing'})`, width));
  lines.push(...formatField('Project config', `${data.paths.projectPath} (${data.paths.projectExists ? 'exists' : 'missing'})`, width));
  lines.push(...formatField('Models dir', `${data.paths.modelsDir} (${existsSync(data.paths.modelsDir) ? 'exists' : 'missing'})`, width));
  lines.push(...formatField('Providers dir', `${data.paths.providersDir} (${existsSync(data.paths.providersDir) ? 'exists' : 'missing'})`, width));
  lines.push(...formatField('Stacks (global)', `${data.paths.stacksGlobalDir} (${existsSync(data.paths.stacksGlobalDir) ? 'exists' : 'missing'})`, width));
  lines.push(...formatField('Stacks (project)', `${data.paths.stacksProjectDir} (${existsSync(data.paths.stacksProjectDir) ? 'exists' : 'missing'})`, width));
  return lines.slice(0, height);
}

function renderModels(data: TuiData, state: TuiState, width: number, height: number): string[] {
  const selectedIndex = state.itemIndexBySection.models ?? 0;
  return renderListSection(
    'Models',
    data.models,
    Math.min(selectedIndex, Math.max(0, data.models.length - 1)),
    width,
    height,
    (entry) => {
      const defaultMark = entry.isDefault ? '*' : ' ';
      return `${defaultMark} ${entry.alias}  ${entry.config.provider}/${entry.config.model}`;
    },
    (entry) => {
      const lines: string[] = [];
      lines.push(...formatField('Alias', entry.alias, width));
      lines.push(...formatField('Provider', entry.config.provider, width));
      lines.push(...formatField('Model', entry.config.model, width));
      lines.push(...formatField('Default', entry.isDefault ? 'yes' : 'no', width));
      lines.push(...formatField('Source', formatSourceLabel(entry.source), width));
      if (entry.config.maxTokens) {
        lines.push(...formatField('Max tokens', `${entry.config.maxTokens}`, width));
      }
      if (entry.config.contextLength) {
        lines.push(...formatField('Context length', `${entry.config.contextLength}`, width));
      }
      if (entry.config.description) {
        lines.push(...formatField('Description', entry.config.description, width));
      }
      if (entry.config.pricing) {
        const pricing = `prompt ${formatPrice(entry.config.pricing.prompt)}, completion ${formatPrice(entry.config.pricing.completion)}`;
        lines.push(...formatField('Pricing', pricing, width));
      }
      return lines;
    }
  );
}

function renderProviders(data: TuiData, state: TuiState, width: number, height: number): string[] {
  const selectedIndex = state.itemIndexBySection.providers ?? 0;
  return renderListSection(
    'Providers',
    data.providers,
    Math.min(selectedIndex, Math.max(0, data.providers.length - 1)),
    width,
    height,
    (entry) => {
      const type = entry.config.type ?? 'unknown';
      const auth = formatProviderAuth(entry.key, entry.config);
      return `${entry.key}  ${type}  ${auth}`;
    },
    (entry) => {
      const lines: string[] = [];
      lines.push(...formatField('Name', entry.key, width));
      lines.push(...formatField('Type', formatValue(entry.config.type), width));
      if (entry.config.baseUrl) {
        lines.push(...formatField('Base URL', entry.config.baseUrl, width));
      }
      lines.push(...formatField('Auth', formatProviderAuth(entry.key, entry.config), width));
      lines.push(...formatField('Source', formatSourceLabel(entry.source), width));

      const extraKeys = Object.keys(entry.config).filter(
        (key) => !['type', 'baseUrl', 'apiKey', 'authType'].includes(key)
      );
      for (const key of extraKeys) {
        const value = formatValue(entry.config[key]);
        lines.push(...formatField(`Extra:${key}`, value, width));
      }
      return lines;
    }
  );
}

function renderStacks(data: TuiData, state: TuiState, width: number, height: number): string[] {
  const selectedIndex = state.itemIndexBySection.stacks ?? 0;
  return renderListSection(
    'Stacks',
    data.stacks,
    Math.min(selectedIndex, Math.max(0, data.stacks.length - 1)),
    width,
    height,
    (entry) => {
      const parts = [entry.name];
      if (entry.model) parts.push(`model:${entry.model}`);
      if (entry.skill) parts.push(`skill:${entry.skill}`);
      if (entry.extends) parts.push(`extends:${entry.extends}`);
      return parts.join(' ');
    },
    (entry) => {
      const lines: string[] = [];
      lines.push(...formatField('Name', entry.name, width));
      lines.push(...formatField('Source', formatSourceLabel(entry.source), width));
      if (entry.path && entry.path !== 'inline') {
        lines.push(...formatField('Path', entry.path, width));
      }
      const resolved = entry.resolved;
      if (resolved?.extends) lines.push(...formatField('Extends', resolved.extends, width));
      if (resolved?.model) lines.push(...formatField('Model', resolved.model, width));
      if (resolved?.skill) lines.push(...formatField('Skill', resolved.skill, width));
      if (resolved?.temperature !== undefined) lines.push(...formatField('Temperature', `${resolved.temperature}`, width));
      if (resolved?.timeout !== undefined) lines.push(...formatField('Timeout', `${resolved.timeout}ms`, width));
      if (resolved?.maxTokens !== undefined) lines.push(...formatField('Max tokens', `${resolved.maxTokens}`, width));
      if (resolved?.tools) lines.push(...formatField('Tools', resolved.tools.join(', '), width));
      if (resolved?.contextFile) lines.push(...formatField('Context file', resolved.contextFile, width));
      if (resolved?.unrestricted) lines.push(...formatField('Unrestricted', 'true', width));
      if (resolved?.context) lines.push(...formatField('Context', resolved.context, width));
      return lines;
    }
  );
}

const STACK_FIELD_DESCRIPTIONS: Record<StackFieldId, string> = {
  extends: 'Parent stack to inherit from.',
  model: 'Model alias or provider model name.',
  skill: 'Skill name to load for this stack.',
  temperature: 'Sampling temperature (0-1).',
  timeout: 'Request timeout (ms, s, m, h).',
  maxTokens: 'Maximum tokens for completion.',
  tools: 'Limit tools to a comma-separated list (use "none" for no tools).',
  unrestricted: 'Bypass guardrails for this stack.',
  contextFile: 'Path to a context file.',
  context: 'Inline context text for the prompt.',
};

const STACK_FIELD_KEYS: Record<StackFieldId, keyof StackConfig> = {
  extends: 'extends',
  model: 'model',
  skill: 'skill',
  temperature: 'temperature',
  timeout: 'timeout',
  maxTokens: 'maxTokens',
  tools: 'tools',
  unrestricted: 'unrestricted',
  contextFile: 'contextFile',
  context: 'context',
};

function buildStackEditFields(entry: StackEntry): StackEditField[] {
  const raw = entry.raw ?? {};
  const resolved = entry.resolved ?? {};
  return [
    {
      id: 'extends',
      label: 'Extends',
      value: formatStackValue(raw.extends, resolved.extends, formatStackString),
      description: STACK_FIELD_DESCRIPTIONS.extends,
    },
    {
      id: 'model',
      label: 'Model',
      value: formatStackValue(raw.model, resolved.model, formatStackString),
      description: STACK_FIELD_DESCRIPTIONS.model,
    },
    {
      id: 'skill',
      label: 'Skill',
      value: formatStackValue(raw.skill, resolved.skill, formatStackString),
      description: STACK_FIELD_DESCRIPTIONS.skill,
    },
    {
      id: 'temperature',
      label: 'Temperature',
      value: formatStackValue(raw.temperature, resolved.temperature, formatStackNumber),
      description: STACK_FIELD_DESCRIPTIONS.temperature,
    },
    {
      id: 'timeout',
      label: 'Timeout',
      value: formatStackValue(raw.timeout, resolved.timeout, formatDuration),
      description: STACK_FIELD_DESCRIPTIONS.timeout,
    },
    {
      id: 'maxTokens',
      label: 'Max tokens',
      value: formatStackValue(raw.maxTokens, resolved.maxTokens, formatStackNumber),
      description: STACK_FIELD_DESCRIPTIONS.maxTokens,
    },
    {
      id: 'tools',
      label: 'Tools',
      value: formatStackValue(raw.tools, resolved.tools, formatStackList),
      description: STACK_FIELD_DESCRIPTIONS.tools,
    },
    {
      id: 'unrestricted',
      label: 'Unrestricted',
      value: formatStackValue(raw.unrestricted, resolved.unrestricted, formatStackBoolean),
      description: STACK_FIELD_DESCRIPTIONS.unrestricted,
    },
    {
      id: 'contextFile',
      label: 'Context file',
      value: formatStackValue(raw.contextFile, resolved.contextFile, formatStackString),
      description: STACK_FIELD_DESCRIPTIONS.contextFile,
    },
    {
      id: 'context',
      label: 'Context',
      value: formatStackValue(raw.context, resolved.context, formatStackContext),
      description: STACK_FIELD_DESCRIPTIONS.context,
    },
  ];
}

function renderSection(section: Section, data: TuiData, state: TuiState, width: number, height: number): string[] {
  switch (section.id) {
    case 'overview':
      return renderOverview(data, width, height);
    case 'models':
      return renderModels(data, state, width, height);
    case 'providers':
      return renderProviders(data, state, width, height);
    case 'stacks':
      return renderStacks(data, state, width, height);
    case 'tools':
      return renderTools(data, width, height);
    case 'retry':
      return renderRetry(data, width, height);
    case 'history':
      return renderHistory(data, width, height);
    case 'agent':
      return renderAgent(data, width, height);
    case 'files':
      return renderFiles(data, width, height);
    default:
      return [''];
  }
}

function getFooterHints(section: Section): string[] {
  switch (section.id) {
    case 'models':
      return ['Arrows: move  A: add  E: edit  D: remove  S: set default  R: refresh  Q: quit'];
    case 'providers':
      return ['Arrows: move  A: add  E: edit  D: remove  L: login  O: logout  R: refresh  Q: quit'];
    case 'stacks':
      return ['Arrows: move  N: new  Enter/E: edit  X: external editor  D: remove  R: refresh  Q: quit'];
    case 'files':
    case 'tools':
    case 'retry':
    case 'history':
    case 'agent':
      return ['G: edit global config  P: edit project config  R: refresh  Q: quit'];
    case 'overview':
    default:
      return ['Tab/Arrows: navigate  M: show merged  G/P: edit config  R: refresh  Q: quit'];
  }
}

function renderFrame(sections: Section[], data: TuiData, state: TuiState, width: number, height: number): string[] {
  const minLeft = 10;
  const minRight = 20;
  let leftWidth = Math.floor(width * 0.25);
  leftWidth = Math.min(26, Math.max(minLeft, leftWidth));
  let rightWidth = width - leftWidth - 1;
  if (rightWidth < minRight) {
    rightWidth = Math.max(0, width - minLeft - 1);
    leftWidth = Math.max(0, width - rightWidth - 1);
  }

  const headerLines = [
    truncateLine(`Karl Config - ${process.cwd()}`, width),
    '-'.repeat(width)
  ];

  const footerHints = getFooterHints(sections[state.sectionIndex]);
  const footerLines = footerHints.map((line) => truncateLine(line, width));

  const contentHeight = Math.max(1, height - headerLines.length - footerLines.length);
  const navLines: string[] = [];
  for (let i = 0; i < sections.length; i++) {
    const prefix = i === state.sectionIndex ? '> ' : '  ';
    const label = truncateLine(getSectionLabel(sections[i], data), leftWidth - prefix.length);
    const padded = padRight(`${prefix}${label}`, leftWidth);
    navLines.push(padded);
  }

  while (navLines.length < contentHeight) {
    navLines.push(padRight('', leftWidth));
  }

  const bodyLines = renderSection(
    sections[state.sectionIndex],
    data,
    state,
    rightWidth,
    contentHeight
  );

  const lines: string[] = [];
  lines.push(...headerLines);
  for (let i = 0; i < contentHeight; i++) {
    const left = navLines[i] ?? padRight('', leftWidth);
    const right = bodyLines[i] ?? '';
    lines.push(`${left} ${truncateLine(right, rightWidth)}`);
  }
  lines.push(...footerLines);

  return lines.map(line => padRight(line, width));
}

function renderStackEditorFrame(
  entry: StackEntry,
  fields: StackEditField[],
  selectedIndex: number,
  width: number,
  height: number
): string[] {
  const headerLines = [
    truncateLine(`Karl Config - Edit Stack: ${entry.name}`, width),
    '-'.repeat(width)
  ];

  const footerLines = [
    truncateLine('Arrows: move  Enter: edit  Backspace: clear  X: external editor  R: refresh  Esc: back  Q: quit', width)
  ];

  const contentHeight = Math.max(1, height - headerLines.length - footerLines.length);
  const listLines = renderListSection(
    'Fields',
    fields,
    Math.min(selectedIndex, Math.max(0, fields.length - 1)),
    width,
    contentHeight,
    (field) => `${field.label}: ${field.value}`,
    (field) => {
      const lines: string[] = [];
      const pathLabel = entry.path && entry.path !== 'inline' ? entry.path : 'inline';
      lines.push(`Source: ${formatSourceLabel(entry.source)}`);
      lines.push(`Path: ${pathLabel}`);
      lines.push('');
      lines.push(field.description);
      lines.push('Values prefixed with "inherit" come from a parent stack.');
      lines.push('Blank input clears the field to inherit again.');
      return lines;
    }
  );

  const lines = [...headerLines, ...listLines, ...footerLines];
  while (lines.length < height) {
    lines.push('');
  }
  return lines.slice(0, height).map(line => padRight(line, width));
}

function resolveConfigTarget(paths: TuiPaths, preferred?: 'global' | 'project'): string {
  if (preferred === 'global') return paths.globalPath;
  if (preferred === 'project') return paths.projectPath;
  if (paths.projectExists) return paths.projectPath;
  return paths.globalPath;
}

async function showConfig(scope: 'merged' | 'global' | 'project'): Promise<void> {
  const cwd = process.cwd();
  if (scope === 'merged') {
    const config = await loadConfig(cwd);
    console.log(JSON.stringify(config, null, 2));
    return;
  }

  const filePath = scope === 'global' ? GLOBAL_CONFIG_PATH : getProjectConfigPath(cwd);
  const config = await readConfigFileSafe(filePath);
  if (!config) {
    console.error(`Config not found at ${filePath}`);
    process.exit(1);
  }
  console.log(JSON.stringify(config, null, 2));
}

async function editConfig(scope?: 'global' | 'project'): Promise<void> {
  const cwd = process.cwd();
  const paths = getConfigPaths(cwd);
  const targetPath = resolveConfigTarget(paths, scope);
  if (targetPath === GLOBAL_CONFIG_PATH) {
    ensureDirForFile(targetPath);
  }
  openInEditor(targetPath);
}

function printConfigSetUsage(): void {
  console.error('Usage: karl config set [--global|--project] [options]');
  console.error('');
  console.error('Options:');
  console.error('  --default-model <alias>');
  console.error('  --tools-enabled <csv|none>');
  console.error('  --tools-custom <csv|none>');
  console.error('  --retry-attempts <number>');
  console.error('  --retry-backoff <exponential|linear>');
  console.error('  --history-enabled <true|false>');
  console.error('  --history-path <path>');
  console.error('  --history-max-diff-bytes <number>');
  console.error('  --history-max-diff-lines <number>');
  console.error('  --agent-model <alias>');
  console.error('  --agent-provider <name>');
  console.error('  --clear <field>  (default-model, tools.enabled, tools.custom, retry.attempts, retry.backoff,');
  console.error('                  history.enabled, history.path, history.max-diff-bytes, history.max-diff-lines,');
  console.error('                  agent.model, agent.provider)');
}

async function setConfig(args: string[]): Promise<void> {
  try {
    let scope: ConfigScope | undefined;
    const updates: ConfigUpdateInput = {};
    const clearFields = new Set<ConfigClearField>();

    const setScope = (nextScope: ConfigScope) => {
      if (scope && scope !== nextScope) {
        console.error('Choose only one of --global or --project.');
        process.exit(1);
      }
      scope = nextScope;
    };

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--global') {
        setScope('global');
      } else if (arg === '--project') {
        setScope('project');
      } else if (arg === '--default-model' && args[i + 1]) {
        updates.defaultModel = args[++i];
      } else if (arg === '--tools-enabled' && args[i + 1]) {
        updates.toolsEnabled = parseList(args[++i]);
      } else if (arg === '--tools-custom' && args[i + 1]) {
        updates.toolsCustom = parseList(args[++i]);
      } else if (arg === '--retry-attempts' && args[i + 1]) {
        const value = parseInt(args[++i], 10);
        if (Number.isNaN(value)) {
          throw new Error('Invalid number for --retry-attempts.');
        }
        updates.retryAttempts = value;
      } else if (arg === '--retry-backoff' && args[i + 1]) {
        const value = args[++i] as 'exponential' | 'linear';
        if (value !== 'exponential' && value !== 'linear') {
          throw new Error('Invalid --retry-backoff. Use exponential or linear.');
        }
        updates.retryBackoff = value;
      } else if (arg === '--history-enabled' && args[i + 1]) {
        updates.historyEnabled = parseBoolean(args[++i]);
      } else if (arg === '--history-path' && args[i + 1]) {
        updates.historyPath = args[++i];
      } else if (arg === '--history-max-diff-bytes' && args[i + 1]) {
        const value = parseInt(args[++i], 10);
        if (Number.isNaN(value)) {
          throw new Error('Invalid number for --history-max-diff-bytes.');
        }
        updates.historyMaxDiffBytes = value;
      } else if (arg === '--history-max-diff-lines' && args[i + 1]) {
        const value = parseInt(args[++i], 10);
        if (Number.isNaN(value)) {
          throw new Error('Invalid number for --history-max-diff-lines.');
        }
        updates.historyMaxDiffLines = value;
      } else if (arg === '--agent-model' && args[i + 1]) {
        updates.agentModel = args[++i];
      } else if (arg === '--agent-provider' && args[i + 1]) {
        updates.agentProvider = args[++i];
      } else if (arg === '--clear' && args[i + 1]) {
        const field = normalizeConfigClearField(args[++i]);
        if (!field) {
          throw new Error(`Unknown field for --clear: ${args[i]}`);
        }
        clearFields.add(field);
      } else if (arg.startsWith('-')) {
        throw new Error(`Unknown option: ${arg}`);
      }
    }

    if (Object.keys(updates).length === 0 && clearFields.size === 0) {
      printConfigSetUsage();
      process.exit(1);
    }

    const cwd = process.cwd();
    const paths = getConfigPaths(cwd);
    const targetPath = resolveConfigTarget(paths, scope);
    if (targetPath === GLOBAL_CONFIG_PATH) {
      ensureDirForFile(targetPath);
    }

    const config = readConfigFileStrict(targetPath);
    const next = applyConfigUpdates(config, updates, clearFields);
    writeConfigFile(targetPath, next);

    console.log(`✓ Config updated at ${targetPath}`);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

export async function launchConfigTui(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error('Config TUI requires an interactive terminal.');
    await showConfig('merged');
    return;
  }

  const backend = createDefaultBackend();
  type PendingOverlay =
    | { kind: 'input'; resolve: (value: string | null) => void }
    | { kind: 'textarea'; resolve: (value: string | null) => void }
    | { kind: 'confirm'; resolve: (value: boolean) => void }
    | { kind: 'picker'; resolve: (value: PickerItem | null) => void };

  let pendingOverlay: PendingOverlay | null = null;

  const openInputOverlay = (options: {
    title: string;
    label?: string;
    value?: string;
    placeholder?: string;
    hint?: string;
    inline?: boolean;
    validate?: (value: string) => string | null;
  }): Promise<string | null> => {
    if (pendingOverlay || state.busy) {
      return Promise.resolve(null);
    }
    const value = options.value ?? '';
    return new Promise((resolve) => {
      pendingOverlay = { kind: 'input', resolve };
      state.overlay = {
        kind: options.inline ? 'inline-input' : 'input',
        title: options.title,
        label: options.label,
        value,
        cursor: value.length,
        placeholder: options.placeholder,
        hint: options.hint,
        validate: options.validate,
      };
      render();
    });
  };

  const openConfirmOverlay = (options: {
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    hint?: string;
  }): Promise<boolean> => {
    if (pendingOverlay || state.busy) {
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      pendingOverlay = { kind: 'confirm', resolve };
      state.overlay = {
        kind: 'confirm',
        title: options.title,
        message: options.message,
        confirmLabel: options.confirmLabel,
        cancelLabel: options.cancelLabel,
        hint: options.hint,
        focused: 'confirm',
      };
      render();
    });
  };

  const openPickerOverlay = (options: {
    title: string;
    items: PickerItem[];
    hint?: string;
    selectedId?: string;
  }): Promise<PickerItem | null> => {
    if (pendingOverlay || state.busy) {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      const selectedIndex = Math.max(
        0,
        options.items.findIndex(item => item.id === options.selectedId)
      );
      pendingOverlay = { kind: 'picker', resolve };
      state.overlay = {
        kind: 'picker',
        title: options.title,
        items: options.items,
        filter: '',
        selectedIndex: selectedIndex >= 0 ? selectedIndex : 0,
        hint: options.hint,
      };
      render();
    });
  };

  const openTextareaOverlay = (options: {
    title: string;
    label?: string;
    value?: string;
    hint?: string;
  }): Promise<string | null> => {
    if (pendingOverlay || state.busy) {
      return Promise.resolve(null);
    }
    const value = options.value ?? '';
    return new Promise((resolve) => {
      pendingOverlay = { kind: 'textarea', resolve };
      state.overlay = {
        kind: 'textarea',
        title: options.title,
        label: options.label,
        value,
        cursor: value.length,
        hint: options.hint,
      };
      render();
    });
  };

  const sections: Section[] = [
    { id: 'overview', label: 'Overview', type: 'detail' },
    { id: 'models', label: 'Models', type: 'list' },
    { id: 'providers', label: 'Providers', type: 'list' },
    { id: 'stacks', label: 'Stacks', type: 'list' },
    { id: 'tools', label: 'Tools', type: 'detail' },
    { id: 'retry', label: 'Retry', type: 'detail' },
    { id: 'history', label: 'History', type: 'detail' },
    { id: 'agent', label: 'Agent', type: 'detail' },
    { id: 'files', label: 'Files', type: 'detail' },
  ];

  const state: TuiState = {
    sectionIndex: 0,
    itemIndexBySection: { models: 0, providers: 0, stacks: 0 },
    busy: false,
    overlay: undefined,
    mode: 'main',
    stackEdit: undefined,
  };

  let data = await loadTuiData(process.cwd());

  const clampSelection = () => {
    const clamp = (index: number, length: number) => {
      if (length <= 0) return 0;
      return Math.max(0, Math.min(index, length - 1));
    };
    state.itemIndexBySection.models = clamp(state.itemIndexBySection.models ?? 0, data.models.length);
    state.itemIndexBySection.providers = clamp(state.itemIndexBySection.providers ?? 0, data.providers.length);
    state.itemIndexBySection.stacks = clamp(state.itemIndexBySection.stacks ?? 0, data.stacks.length);
  };

  const refreshData = async () => {
    data = await loadTuiData(process.cwd());
    clampSelection();
    if (state.mode === 'stack-edit' && state.stackEdit) {
      const stillExists = data.stacks.some(stack => stack.name === state.stackEdit?.name);
      if (!stillExists) {
        state.mode = 'main';
        state.stackEdit = undefined;
      }
    }
  };

  const clearScreen = () => {
    process.stdout.write('\x1b[2J\x1b[H');
  };

  const render = () => {
    clearScreen();
    const width = process.stdout.columns || 80;
    const height = process.stdout.rows || 24;
    const frameLines = (() => {
      if (state.mode === 'stack-edit' && state.stackEdit) {
        const entry = data.stacks.find(stack => stack.name === state.stackEdit?.name);
        if (entry) {
          const fields = buildStackEditFields(entry);
          const index = Math.max(0, Math.min(state.stackEdit.fieldIndex, Math.max(0, fields.length - 1)));
          state.stackEdit.fieldIndex = index;
          return renderStackEditorFrame(entry, fields, index, width, height);
        }
      }
      return renderFrame(sections, data, state, width, height);
    })();
    const outputLines = state.overlay
      ? applyOverlay(frameLines, renderOverlay(state.overlay, width, height), width)
      : frameLines;
    process.stdout.write(outputLines.join('\n'));
  };

  const resolveOverlay = (command: OverlayCommand) => {
    if (!pendingOverlay) {
      state.overlay = undefined;
      return;
    }
    const pending = pendingOverlay;
    pendingOverlay = null;
    state.overlay = undefined;

    if (command.type === 'cancel') {
      if (pending.kind === 'confirm') {
        pending.resolve(false);
      } else {
        pending.resolve(null);
      }
      return;
    }

    if (pending.kind === 'confirm') {
      pending.resolve(true);
      return;
    }
    if (pending.kind === 'picker') {
      pending.resolve(command.selection ?? null);
      return;
    }
    pending.resolve(command.value ?? '');
  };

  const suspend = () => {
    process.stdout.write('\x1b[?25h');
    process.stdin.setRawMode?.(false);
    process.stdin.pause();
    process.stdin.removeListener('keypress', onKeypress);
    process.stdout.removeListener('resize', render);
    clearScreen();
  };

  const resume = () => {
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.on('keypress', onKeypress);
    process.stdout.on('resize', render);
    process.stdout.write('\x1b[?25l');
  };

  const exit = () => {
    process.stdout.write('\x1b[?25h');
    process.stdin.setRawMode?.(false);
    process.stdin.pause();
    process.stdin.removeListener('keypress', onKeypress);
    process.stdout.removeListener('resize', render);
    clearScreen();
  };

  const runAction = async (
    action: () => Promise<void>,
    options: { pauseAfter?: boolean; refresh?: boolean } = {}
  ) => {
    if (state.busy) return;
    state.busy = true;
    suspend();
    try {
      await action();
    } catch (error) {
      console.error(formatError(error));
    }
    if (options.pauseAfter !== false) {
      await waitForEnter();
    }
    if (options.refresh !== false) {
      await refreshData();
    }
    resume();
    render();
    state.busy = false;
  };

  const getStackEditEntry = (): StackEntry | null => {
    if (!state.stackEdit) return null;
    return data.stacks.find(entry => entry.name === state.stackEdit?.name) ?? null;
  };

  const enterStackEditor = (entry: StackEntry) => {
    state.mode = 'stack-edit';
    state.stackEdit = { name: entry.name, fieldIndex: 0 };
    render();
  };

  const exitStackEditor = () => {
    state.mode = 'main';
    state.stackEdit = undefined;
    render();
  };

  const moveStackField = (delta: number) => {
    if (state.mode !== 'stack-edit' || !state.stackEdit) return;
    const entry = getStackEditEntry();
    if (!entry) return;
    const fields = buildStackEditFields(entry);
    if (fields.length === 0) return;
    const next = Math.max(0, Math.min(state.stackEdit.fieldIndex + delta, fields.length - 1));
    state.stackEdit.fieldIndex = next;
    render();
  };

  const applyStackChanges = async (
    entry: StackEntry,
    changes: Partial<StackConfig>,
    clearFields?: Set<keyof StackConfig>
  ) => {
    if (Object.keys(changes).length === 0 && (!clearFields || clearFields.size === 0)) {
      return;
    }
    await runAction(async () => {
      await backend.updateStack(entry.name, changes, clearFields);
    }, { pauseAfter: false });
  };

  const openExternalStackEditor = async (entry: StackEntry) => {
    await runAction(async () => {
      if (entry.source === 'file') {
        await backend.editStack(entry.name);
        return;
      }
      const target = entry.source === 'inline-project'
        ? 'project'
        : entry.source === 'inline-global'
          ? 'global'
          : undefined;
      await editConfig(target);
    }, { pauseAfter: !hasEditor() });
  };

  const clearStackField = async (entry: StackEntry, fieldId: StackFieldId) => {
    const key = STACK_FIELD_KEYS[fieldId];
    await applyStackChanges(entry, {}, new Set([key]));
  };

  const buildModelPickerItems = (): PickerItem[] => {
    return [
      { id: '__clear__', label: '(inherit)' },
      { id: '__manual__', label: 'Custom value...' },
      ...data.models.map((model) => ({
        id: model.alias,
        label: model.alias,
        detail: `${model.config.provider}/${model.config.model}`,
      })),
    ];
  };

  const buildSkillPickerItems = async (): Promise<PickerItem[]> => {
    const skills = await skillManager.listSkills().catch(() => []);
    return [
      { id: '__clear__', label: '(inherit)' },
      { id: '__manual__', label: 'Custom value...' },
      ...skills.map((skill) => ({
        id: skill.name,
        label: skill.name,
        detail: skill.description,
      })),
    ];
  };

  const buildExtendsPickerItems = (currentName: string): PickerItem[] => {
    const stackItems = data.stacks
      .filter(stack => stack.name !== currentName)
      .map((stack) => {
        const detailParts: string[] = [];
        if (stack.model) detailParts.push(`model:${stack.model}`);
        if (stack.skill) detailParts.push(`skill:${stack.skill}`);
        if (stack.extends) detailParts.push(`extends:${stack.extends}`);
        return {
          id: stack.name,
          label: stack.name,
          detail: detailParts.join(' '),
        };
      });
    return [
      { id: '__clear__', label: '(inherit)' },
      { id: '__manual__', label: 'Custom value...' },
      ...stackItems,
    ];
  };

  const editStackField = async (entry: StackEntry, field: StackEditField) => {
    const raw = entry.raw ?? {};
    const resolved = entry.resolved ?? {};
    switch (field.id) {
      case 'model': {
        const selection = await openPickerOverlay({
          title: `Stack: ${entry.name}`,
          items: buildModelPickerItems(),
          hint: 'Enter: select  Esc: cancel',
          selectedId: raw.model ?? '__clear__',
        });
        if (!selection) return;
        if (selection.id === '__clear__') {
          await clearStackField(entry, 'model');
          return;
        }
        if (selection.id === '__manual__') {
          const inherited = raw.model === undefined ? resolved.model : undefined;
          const value = await openInputOverlay({
            title: `Stack: ${entry.name}`,
            label: 'Model',
            value: raw.model ?? '',
            placeholder: inherited ? `inherit: ${inherited}` : 'model alias',
            hint: 'Enter: save  Esc: cancel',
          });
          if (value === null) return;
          const next = value.trim();
          if (!next) {
            await clearStackField(entry, 'model');
            return;
          }
          await applyStackChanges(entry, { model: next });
          return;
        }
        await applyStackChanges(entry, { model: selection.id });
        return;
      }
      case 'skill': {
        const items = await buildSkillPickerItems();
        const selection = await openPickerOverlay({
          title: `Stack: ${entry.name}`,
          items,
          hint: 'Enter: select  Esc: cancel',
          selectedId: raw.skill ?? '__clear__',
        });
        if (!selection) return;
        if (selection.id === '__clear__') {
          await clearStackField(entry, 'skill');
          return;
        }
        if (selection.id === '__manual__') {
          const inherited = raw.skill === undefined ? resolved.skill : undefined;
          const value = await openInputOverlay({
            title: `Stack: ${entry.name}`,
            label: 'Skill',
            value: raw.skill ?? '',
            placeholder: inherited ? `inherit: ${inherited}` : 'skill name',
            hint: 'Enter: save  Esc: cancel',
          });
          if (value === null) return;
          const next = value.trim();
          if (!next) {
            await clearStackField(entry, 'skill');
            return;
          }
          await applyStackChanges(entry, { skill: next });
          return;
        }
        await applyStackChanges(entry, { skill: selection.id });
        return;
      }
      case 'extends': {
        const selection = await openPickerOverlay({
          title: `Stack: ${entry.name}`,
          items: buildExtendsPickerItems(entry.name),
          hint: 'Enter: select  Esc: cancel',
          selectedId: raw.extends ?? '__clear__',
        });
        if (!selection) return;
        if (selection.id === '__clear__') {
          await clearStackField(entry, 'extends');
          return;
        }
        if (selection.id === '__manual__') {
          const inherited = raw.extends === undefined ? resolved.extends : undefined;
          const value = await openInputOverlay({
            title: `Stack: ${entry.name}`,
            label: 'Extends',
            value: raw.extends ?? '',
            placeholder: inherited ? `inherit: ${inherited}` : 'parent stack',
            hint: 'Enter: save  Esc: cancel',
          });
          if (value === null) return;
          const next = value.trim();
          if (!next) {
            await clearStackField(entry, 'extends');
            return;
          }
          await applyStackChanges(entry, { extends: next });
          return;
        }
        await applyStackChanges(entry, { extends: selection.id });
        return;
      }
      case 'temperature': {
        const value = await openInputOverlay({
          title: `Stack: ${entry.name}`,
          label: 'Temperature',
          value: raw.temperature !== undefined ? `${raw.temperature}` : '',
          placeholder: raw.temperature === undefined && resolved.temperature !== undefined
            ? `inherit: ${resolved.temperature}`
            : '0.7',
          hint: 'Enter: save  Esc: cancel',
          validate: (input) => {
            if (!input.trim()) return null;
            const parsed = parseFloat(input);
            if (Number.isNaN(parsed)) return 'Enter a number between 0 and 1.';
            if (parsed < 0 || parsed > 1) return 'Use a value between 0 and 1.';
            return null;
          },
        });
        if (value === null) return;
        const trimmed = value.trim();
        if (!trimmed) {
          await clearStackField(entry, 'temperature');
          return;
        }
        await applyStackChanges(entry, { temperature: parseFloat(trimmed) });
        return;
      }
      case 'timeout': {
        const value = await openInputOverlay({
          title: `Stack: ${entry.name}`,
          label: 'Timeout',
          value: raw.timeout !== undefined ? formatDuration(raw.timeout) : '',
          placeholder: raw.timeout === undefined && resolved.timeout !== undefined
            ? `inherit: ${formatDuration(resolved.timeout)}`
            : '30s',
          hint: 'Enter: save  Esc: cancel',
          validate: (input) => {
            if (!input.trim()) return null;
            try {
              parseDurationInput(input);
              return null;
            } catch (error) {
              return (error as Error).message;
            }
          },
        });
        if (value === null) return;
        const trimmed = value.trim();
        if (!trimmed) {
          await clearStackField(entry, 'timeout');
          return;
        }
        await applyStackChanges(entry, { timeout: parseDurationInput(trimmed) });
        return;
      }
      case 'maxTokens': {
        const value = await openInputOverlay({
          title: `Stack: ${entry.name}`,
          label: 'Max tokens',
          value: raw.maxTokens !== undefined ? `${raw.maxTokens}` : '',
          placeholder: raw.maxTokens === undefined && resolved.maxTokens !== undefined
            ? `inherit: ${resolved.maxTokens}`
            : '2048',
          hint: 'Enter: save  Esc: cancel',
          validate: (input) => {
            if (!input.trim()) return null;
            const parsed = parseInt(input, 10);
            if (Number.isNaN(parsed) || parsed <= 0) return 'Enter a positive integer.';
            return null;
          },
        });
        if (value === null) return;
        const trimmed = value.trim();
        if (!trimmed) {
          await clearStackField(entry, 'maxTokens');
          return;
        }
        await applyStackChanges(entry, { maxTokens: parseInt(trimmed, 10) });
        return;
      }
      case 'tools': {
        const value = await openInputOverlay({
          title: `Stack: ${entry.name}`,
          label: 'Tools',
          value: raw.tools ? (raw.tools.length === 0 ? 'none' : raw.tools.join(', ')) : '',
          placeholder: raw.tools === undefined && resolved.tools
            ? `inherit: ${formatStackList(resolved.tools)}`
            : 'read, bash',
          hint: 'Enter: save  Esc: cancel',
        });
        if (value === null) return;
        const trimmed = value.trim();
        if (!trimmed) {
          await clearStackField(entry, 'tools');
          return;
        }
        if (trimmed.toLowerCase() === 'none') {
          await applyStackChanges(entry, { tools: [] });
          return;
        }
        const parts = trimmed.split(',').map(part => part.trim()).filter(Boolean);
        await applyStackChanges(entry, { tools: Array.from(new Set(parts)) });
        return;
      }
      case 'unrestricted': {
        const selection = await openPickerOverlay({
          title: `Stack: ${entry.name}`,
          items: [
            { id: '__clear__', label: '(inherit)' },
            { id: 'true', label: 'true' },
            { id: 'false', label: 'false' },
          ],
          hint: 'Enter: select  Esc: cancel',
          selectedId: raw.unrestricted === undefined ? '__clear__' : String(raw.unrestricted),
        });
        if (!selection) return;
        if (selection.id === '__clear__') {
          await clearStackField(entry, 'unrestricted');
          return;
        }
        await applyStackChanges(entry, { unrestricted: selection.id === 'true' });
        return;
      }
      case 'contextFile': {
        const inherited = raw.contextFile === undefined ? resolved.contextFile : undefined;
        const value = await openInputOverlay({
          title: `Stack: ${entry.name}`,
          label: 'Context file',
          value: raw.contextFile ?? '',
          placeholder: inherited ? `inherit: ${inherited}` : 'path',
          hint: 'Enter: save  Esc: cancel',
        });
        if (value === null) return;
        const trimmed = value.trim();
        if (!trimmed) {
          await clearStackField(entry, 'contextFile');
          return;
        }
        await applyStackChanges(entry, { contextFile: trimmed });
        return;
      }
      case 'context': {
        const value = await openTextareaOverlay({
          title: `Stack: ${entry.name}`,
          label: 'Context',
          value: raw.context ?? '',
          hint: 'Ctrl+S: save  Esc: cancel',
        });
        if (value === null) return;
        if (!value.trim()) {
          await clearStackField(entry, 'context');
          return;
        }
        await applyStackChanges(entry, { context: value });
        return;
      }
      default:
        return;
    }
  };

  const moveSection = (delta: number) => {
    const next = (state.sectionIndex + delta + sections.length) % sections.length;
    state.sectionIndex = next;
    render();
  };

  const moveItem = (delta: number) => {
    const section = sections[state.sectionIndex];
    if (section.type !== 'list') return;
    const listLength = section.id === 'models'
      ? data.models.length
      : section.id === 'providers'
        ? data.providers.length
        : data.stacks.length;
    const current = state.itemIndexBySection[section.id] ?? 0;
    const next = Math.max(0, Math.min(current + delta, Math.max(0, listLength - 1)));
    state.itemIndexBySection[section.id] = next;
    render();
  };

  const onKeypress = async (str: string, key: { name?: string; ctrl?: boolean; shift?: boolean; meta?: boolean }) => {
    if (state.busy) return;
    if (key.ctrl && key.name === 'c') {
      exit();
      return;
    }
    if (state.overlay) {
      const result = updateOverlay(state.overlay, key, str);
      if (result.overlay) {
        state.overlay = result.overlay;
      }
      if (result.command) {
        resolveOverlay(result.command);
      }
      if (!result.overlay) {
        state.overlay = undefined;
      }
      render();
      return;
    }
    if (state.mode === 'stack-edit') {
      const entry = getStackEditEntry();
      if (!entry || !state.stackEdit) {
        exitStackEditor();
        return;
      }
      const fields = buildStackEditFields(entry);
      const currentField = fields[state.stackEdit.fieldIndex];
      switch (key.name) {
        case 'escape':
        case 'b':
          exitStackEditor();
          return;
        case 'q':
          exit();
          return;
        case 'left':
        case 'up':
          moveStackField(-1);
          return;
        case 'right':
        case 'down':
          moveStackField(1);
          return;
        case 'tab':
          moveStackField(key.shift ? -1 : 1);
          return;
        case 'r':
          await runAction(async () => {
            await refreshData();
          }, { pauseAfter: false, refresh: false });
          return;
        case 'x':
          await openExternalStackEditor(entry);
          return;
        case 'backspace':
          if (currentField) {
            await clearStackField(entry, currentField.id);
          }
          return;
        case 'return':
          if (currentField) {
            await editStackField(entry, currentField);
          }
          return;
      }
      return;
    }
    switch (key.name) {
      case 'q':
      case 'escape':
        exit();
        return;
      case 'left':
        moveSection(-1);
        return;
      case 'right':
        moveSection(1);
        return;
      case 'tab':
        moveSection(key.shift ? -1 : 1);
        return;
      case 'up':
        moveItem(-1);
        return;
      case 'down':
        moveItem(1);
        return;
      case 'r':
        await runAction(async () => {
          await refreshData();
        }, { pauseAfter: false, refresh: false });
        return;
      case 'g':
        await runAction(async () => {
          await editConfig('global');
        }, { pauseAfter: !hasEditor() });
        return;
      case 'p':
        await runAction(async () => {
          await editConfig('project');
        }, { pauseAfter: !hasEditor() });
        return;
      case 'm':
        await runAction(async () => {
          await showConfig('merged');
        });
        return;
    }

    const currentSection = sections[state.sectionIndex].id;
    if (key.name === 'a' && currentSection === 'models') {
      const alias = await openInputOverlay({
        title: 'Add Model',
        label: 'Alias',
        placeholder: 'model alias',
        hint: 'Enter: confirm  Esc: cancel'
      });
      if (!alias) return;
      await runAction(async () => {
        await backend.addModel({ alias });
      });
      return;
    }

    if (key.name === 'a' && currentSection === 'providers') {
      await runAction(async () => {
        await backend.addProvider();
      });
      return;
    }

    if (key.name === 'n' && currentSection === 'stacks') {
      const name = await openInputOverlay({
        title: 'New Stack',
        label: 'Name',
        placeholder: 'stack name',
        hint: 'Enter: confirm  Esc: cancel'
      });
      if (!name) return;
      const location = await openPickerOverlay({
        title: 'Stack Location',
        items: [
          { id: 'project', label: 'Project (.karl/stacks)' },
          { id: 'global', label: 'Global (~/.config/karl/stacks)' },
        ],
        hint: 'Enter: select  Esc: cancel'
      });
      if (!location) return;
      await runAction(async () => {
        await backend.createStack(name, { global: location.id === 'global' });
      });
      return;
    }

    if (key.name === 'e' && currentSection === 'models') {
      const entry = data.models[state.itemIndexBySection.models ?? 0];
      if (!entry) return;
      await runAction(async () => {
        await backend.editModel(entry.alias);
      }, { pauseAfter: !hasEditor() });
      return;
    }

    if (key.name === 'e' && currentSection === 'providers') {
      const entry = data.providers[state.itemIndexBySection.providers ?? 0];
      if (!entry) return;
      await runAction(async () => {
        await backend.editProvider(entry.key);
      }, { pauseAfter: !hasEditor() });
      return;
    }

    if ((key.name === 'e' || key.name === 'return') && currentSection === 'stacks') {
      const entry = data.stacks[state.itemIndexBySection.stacks ?? 0];
      if (!entry) return;
      enterStackEditor(entry);
      return;
    }

    if (key.name === 'x' && currentSection === 'stacks') {
      const entry = data.stacks[state.itemIndexBySection.stacks ?? 0];
      if (!entry) return;
      await openExternalStackEditor(entry);
      return;
    }

    if (key.name === 'd' && currentSection === 'models') {
      const entry = data.models[state.itemIndexBySection.models ?? 0];
      if (!entry) return;
      if (entry.source !== 'file') {
        await runAction(async () => {
          console.log('Inline models are defined in a config file.');
          console.log('Use karl config edit to update them.');
        });
        return;
      }
      const confirmed = await openConfirmOverlay({
        title: 'Remove Model',
        message: `Remove model "${entry.alias}"?`,
        hint: 'Enter: confirm  Esc: cancel'
      });
      if (!confirmed) return;
      await runAction(async () => {
        await backend.removeModel(entry.alias);
      });
      return;
    }

    if (key.name === 'd' && currentSection === 'providers') {
      const entry = data.providers[state.itemIndexBySection.providers ?? 0];
      if (!entry) return;
      if (entry.source !== 'file') {
        await runAction(async () => {
          console.log('Inline providers are defined in a config file.');
          console.log('Use karl config edit to update them.');
        });
        return;
      }
      const confirmed = await openConfirmOverlay({
        title: 'Remove Provider',
        message: `Remove provider "${entry.key}"?`,
        hint: 'Enter: confirm  Esc: cancel'
      });
      if (!confirmed) return;
      await runAction(async () => {
        await backend.removeProvider(entry.key);
      });
      return;
    }

    if (key.name === 'd' && currentSection === 'stacks') {
      const entry = data.stacks[state.itemIndexBySection.stacks ?? 0];
      if (!entry) return;
      if (entry.source !== 'file') {
        await runAction(async () => {
          console.log('Inline stacks are defined in a config file.');
          console.log('Use karl config edit to update them.');
        });
        return;
      }
      const confirmed = await openConfirmOverlay({
        title: 'Remove Stack',
        message: `Remove stack "${entry.name}"?`,
        hint: 'Enter: confirm  Esc: cancel'
      });
      if (!confirmed) return;
      await runAction(async () => {
        await backend.removeStack(entry.name);
      });
      return;
    }

    if (key.name === 's' && currentSection === 'models') {
      const entry = data.models[state.itemIndexBySection.models ?? 0];
      if (!entry) return;
      await runAction(async () => {
        if (entry.source !== 'file') {
          console.log('Inline models are defined in a config file.');
          console.log('Use karl config edit to set the default model.');
          return;
        }
        await backend.setDefaultModel(entry.alias);
      });
      return;
    }

    if (key.name === 'l' && currentSection === 'providers') {
      const entry = data.providers[state.itemIndexBySection.providers ?? 0];
      if (!entry) return;
      await runAction(async () => {
        if (entry.source !== 'file') {
          console.log('Inline providers are defined in a config file.');
          console.log('Use karl config edit to update them.');
          return;
        }
        await backend.loginProvider(entry.key);
      });
      return;
    }

    if (key.name === 'o' && currentSection === 'providers') {
      const entry = data.providers[state.itemIndexBySection.providers ?? 0];
      if (!entry) return;
      await runAction(async () => {
        if (entry.source !== 'file') {
          console.log('Inline providers are defined in a config file.');
          console.log('Use karl config edit to update them.');
          return;
        }
        await backend.logoutProvider(entry.key);
      });
      return;
    }
  };

  process.stdout.write('\x1b[?25l');
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode?.(true);
  process.stdin.resume();
  process.stdin.on('keypress', onKeypress);
  process.stdout.on('resize', render);

  render();
}

export async function handleConfigCommand(args: string[]): Promise<void> {
  const [command, ...rest] = args;

  if (!command || command === 'tui') {
    await launchConfigTui();
    return;
  }

  if (command === 'show') {
    const scope = rest.includes('--global')
      ? 'global'
      : rest.includes('--project')
        ? 'project'
        : 'merged';
    await showConfig(scope);
    return;
  }

  if (command === 'edit') {
    const scope = rest.includes('--global')
      ? 'global'
      : rest.includes('--project')
        ? 'project'
        : undefined;
    await editConfig(scope);
    return;
  }

  if (command === 'set' || command === 'update') {
    await setConfig(rest);
    return;
  }

  console.error('Usage: karl config [tui|show|edit|set]');
  console.error('');
  console.error('Commands:');
  console.error('  tui                 Launch the config TUI');
  console.error('  show [--global|--project]  Show config JSON');
  console.error('  edit [--global|--project]  Edit config in $EDITOR');
  console.error('  set [--global|--project]   Update config fields');
  process.exit(1);
}
