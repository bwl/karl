import path from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { loadConfig } from '../config.js';
import { readTextIfExists, resolveHomePath } from '../utils.js';
import type { KarlConfig } from '../types.js';
import { launchOpenTuiConfig } from './config-tui.js';

const GLOBAL_CONFIG_PATH = resolveHomePath('~/.config/karl/karl.json');

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

interface ConfigPaths {
  globalPath: string;
  projectPath: string;
  globalExists: boolean;
  projectExists: boolean;
}

function getProjectConfigPath(cwd: string): string {
  return path.join(cwd, '.karl.json');
}

function getConfigPaths(cwd: string): ConfigPaths {
  const projectPath = getProjectConfigPath(cwd);
  return {
    globalPath: GLOBAL_CONFIG_PATH,
    projectPath,
    globalExists: existsSync(GLOBAL_CONFIG_PATH),
    projectExists: existsSync(projectPath),
  };
}

async function readConfigFile(filePath: string): Promise<Partial<KarlConfig> | null> {
  const content = await readTextIfExists(filePath);
  if (!content) return null;
  try {
    return JSON.parse(content) as Partial<KarlConfig>;
  } catch {
    return null;
  }
}

function readConfigFileStrict(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) return {};
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Invalid config JSON at ${filePath}: ${(error as Error).message}`);
  }
}

function ensureDirForFile(filePath: string): void {
  const directory = path.dirname(filePath);
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
}

function writeConfigFile(filePath: string, data: Record<string, unknown>): void {
  ensureDirForFile(filePath);
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

function parseBoolean(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  throw new Error(`Invalid boolean: "${value}" (use true/false)`);
}

function parseList(value: string): string[] {
  if (value.trim().toLowerCase() === 'none') return [];
  return value.split(',').map(entry => entry.trim()).filter(Boolean);
}

function normalizeConfigClearField(field: string): ConfigClearField | null {
  const fields: Record<string, ConfigClearField> = {
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
  return fields[field] ?? null;
}

function removeEmptyObject(parent: Record<string, unknown>, key: string): void {
  const value = parent[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  if (Object.keys(value as Record<string, unknown>).length === 0) delete parent[key];
}

export function applyConfigUpdates(
  config: Record<string, unknown>,
  updates: ConfigUpdateInput,
  clearFields: Set<ConfigClearField>
): Record<string, unknown> {
  const next = { ...config } as Record<string, any>;

  if (updates.defaultModel !== undefined) next.defaultModel = updates.defaultModel;
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
    updates.historyEnabled !== undefined
    || updates.historyPath !== undefined
    || updates.historyMaxDiffBytes !== undefined
    || updates.historyMaxDiffLines !== undefined
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
      case 'defaultModel': delete next.defaultModel; break;
      case 'tools.enabled': if (next.tools) delete next.tools.enabled; break;
      case 'tools.custom': if (next.tools) delete next.tools.custom; break;
      case 'retry.attempts': if (next.retry) delete next.retry.attempts; break;
      case 'retry.backoff': if (next.retry) delete next.retry.backoff; break;
      case 'history.enabled': if (next.history) delete next.history.enabled; break;
      case 'history.path': if (next.history) delete next.history.path; break;
      case 'history.maxDiffBytes': if (next.history) delete next.history.maxDiffBytes; break;
      case 'history.maxDiffLines': if (next.history) delete next.history.maxDiffLines; break;
      case 'agent.model': if (next.agent) delete next.agent.model; break;
      case 'agent.provider': if (next.agent) delete next.agent.provider; break;
    }
  }

  removeEmptyObject(next, 'tools');
  removeEmptyObject(next, 'retry');
  removeEmptyObject(next, 'history');
  removeEmptyObject(next, 'agent');
  return next;
}

function resolveConfigTarget(paths: ConfigPaths, preferred?: ConfigScope): string {
  if (preferred === 'global') return paths.globalPath;
  if (preferred === 'project') return paths.projectPath;
  return paths.projectExists ? paths.projectPath : paths.globalPath;
}

async function showConfig(scope: 'merged' | ConfigScope): Promise<void> {
  const cwd = process.cwd();
  if (scope === 'merged') {
    console.log(JSON.stringify(await loadConfig(cwd), null, 2));
    return;
  }
  const filePath = scope === 'global' ? GLOBAL_CONFIG_PATH : getProjectConfigPath(cwd);
  const config = await readConfigFile(filePath);
  if (!config) {
    console.error(`Config not found at ${filePath}`);
    process.exit(1);
  }
  console.log(JSON.stringify(config, null, 2));
}

async function editConfig(scope?: ConfigScope): Promise<void> {
  const targetPath = resolveConfigTarget(getConfigPaths(process.cwd()), scope);
  ensureDirForFile(targetPath);
  const editor = process.env.EDITOR || process.env.VISUAL;
  if (editor) spawnSync(editor, [targetPath], { stdio: 'inherit' });
  else {
    console.log(`File: ${targetPath}`);
    console.log('Set $EDITOR to open automatically.');
  }
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
  console.error('  --clear <field>');
}

async function setConfig(args: string[]): Promise<void> {
  try {
    let scope: ConfigScope | undefined;
    const updates: ConfigUpdateInput = {};
    const clearFields = new Set<ConfigClearField>();
    const setScope = (next: ConfigScope) => {
      if (scope && scope !== next) throw new Error('Choose only one of --global or --project.');
      scope = next;
    };

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--global') setScope('global');
      else if (arg === '--project') setScope('project');
      else if (arg === '--default-model' && args[i + 1]) updates.defaultModel = args[++i];
      else if (arg === '--tools-enabled' && args[i + 1]) updates.toolsEnabled = parseList(args[++i]);
      else if (arg === '--tools-custom' && args[i + 1]) updates.toolsCustom = parseList(args[++i]);
      else if (arg === '--retry-attempts' && args[i + 1]) {
        const value = parseInt(args[++i], 10);
        if (Number.isNaN(value)) throw new Error('Invalid number for --retry-attempts.');
        updates.retryAttempts = value;
      } else if (arg === '--retry-backoff' && args[i + 1]) {
        const value = args[++i] as 'exponential' | 'linear';
        if (value !== 'exponential' && value !== 'linear') throw new Error('Invalid --retry-backoff. Use exponential or linear.');
        updates.retryBackoff = value;
      } else if (arg === '--history-enabled' && args[i + 1]) updates.historyEnabled = parseBoolean(args[++i]);
      else if (arg === '--history-path' && args[i + 1]) updates.historyPath = args[++i];
      else if (arg === '--history-max-diff-bytes' && args[i + 1]) {
        const value = parseInt(args[++i], 10);
        if (Number.isNaN(value)) throw new Error('Invalid number for --history-max-diff-bytes.');
        updates.historyMaxDiffBytes = value;
      } else if (arg === '--history-max-diff-lines' && args[i + 1]) {
        const value = parseInt(args[++i], 10);
        if (Number.isNaN(value)) throw new Error('Invalid number for --history-max-diff-lines.');
        updates.historyMaxDiffLines = value;
      } else if (arg === '--agent-model' && args[i + 1]) updates.agentModel = args[++i];
      else if (arg === '--agent-provider' && args[i + 1]) updates.agentProvider = args[++i];
      else if (arg === '--clear' && args[i + 1]) {
        const field = normalizeConfigClearField(args[++i]);
        if (!field) throw new Error(`Unknown field for --clear: ${args[i]}`);
        clearFields.add(field);
      } else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    }

    if (Object.keys(updates).length === 0 && clearFields.size === 0) {
      printConfigSetUsage();
      process.exit(1);
    }
    const targetPath = resolveConfigTarget(getConfigPaths(process.cwd()), scope);
    const next = applyConfigUpdates(readConfigFileStrict(targetPath), updates, clearFields);
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
  await launchOpenTuiConfig();
}

export async function handleConfigCommand(args: string[]): Promise<void> {
  const [command, ...rest] = args;
  if (!command || command === 'tui') return launchConfigTui();
  if (command === 'doctor') {
    const { diagnoseConfig, printConfigDoctorReport } = await import('../config-doctor.js');
    const report = await diagnoseConfig(process.cwd());
    if (rest.includes('--json')) console.log(JSON.stringify(report, null, 2));
    else printConfigDoctorReport(report);
    if (!report.ok) process.exitCode = 1;
    return;
  }
  if (command === 'show') {
    const scope = rest.includes('--global') ? 'global' : rest.includes('--project') ? 'project' : 'merged';
    return showConfig(scope);
  }
  if (command === 'edit') {
    const scope = rest.includes('--global') ? 'global' : rest.includes('--project') ? 'project' : undefined;
    return editConfig(scope);
  }
  if (command === 'set' || command === 'update') return setConfig(rest);

  console.error('Usage: karl config [tui|doctor|show|edit|set]');
  console.error('');
  console.error('Commands:');
  console.error('  tui                       Launch the config TUI');
  console.error('  doctor [--json]           Validate effective configuration');
  console.error('  show [--global|--project] Show config JSON');
  console.error('  edit [--global|--project] Edit config in $EDITOR');
  console.error('  set [--global|--project]  Update config fields');
  process.exit(1);
}
