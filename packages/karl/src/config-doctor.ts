import { existsSync, readFileSync, readdirSync } from 'fs';
import path from 'path';
import { loadConfig } from './config.js';
import { getOAuthStorageKey, isOAuthCredentialsExpired, loadOAuthCredentials } from './oauth.js';
import { isSandboxAvailable } from './sandbox.js';
import type { KarlConfig, StackConfig } from './types.js';
import { resolveHomePath } from './utils.js';

export type DiagnosticSeverity = 'error' | 'warning';

export interface ConfigDiagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  source?: string;
}

export interface ConfigDoctorReport {
  schemaVersion: 1;
  ok: boolean;
  sources: {
    precedence: string[];
    globalConfig: { path: string; exists: boolean };
    projectConfig: { path: string; exists: boolean };
    providersDirectory: string;
    modelsDirectory: string;
    globalStacksDirectory: string;
    projectStacksDirectory: string;
  };
  effective: {
    defaultModel: string | null;
    providers: Array<{ name: string; source: string; auth: { method: 'api_key' | 'oauth'; ready: boolean; detail: string } }>;
    models: Array<{ name: string; source: string; provider: string; model: string; valid: boolean }>;
    stacks: Array<{ name: string; source: string; model: string | null; extends: string | null; skill: string | null; valid: boolean }>;
  };
  sandbox: { platform: string; available: boolean; detail: string };
  diagnostics: ConfigDiagnostic[];
  summary: { errors: number; warnings: number };
}

interface ParsedFile {
  value: Record<string, unknown> | null;
  exists: boolean;
}

function parseObjectFile(filePath: string, diagnostics: ConfigDiagnostic[], kind: string): ParsedFile {
  if (!existsSync(filePath)) return { value: null, exists: false };
  try {
    const value: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      diagnostics.push({ severity: 'error', code: 'invalid_shape', message: `${kind} must contain a JSON object.`, source: filePath });
      return { value: null, exists: true };
    }
    return { value: value as Record<string, unknown>, exists: true };
  } catch (error) {
    diagnostics.push({
      severity: 'error',
      code: 'invalid_json',
      message: `${kind} contains invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      source: filePath,
    });
    return { value: null, exists: true };
  }
}

function scanDirectory(
  directory: string,
  kind: string,
  diagnostics: ConfigDiagnostic[]
): Map<string, { value: Record<string, unknown>; source: string }> {
  const result = new Map<string, { value: Record<string, unknown>; source: string }>();
  if (!existsSync(directory)) return result;
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    diagnostics.push({ severity: 'error', code: 'unreadable_directory', message: `Cannot read ${kind} directory: ${String(error)}`, source: directory });
    return result;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const source = path.join(directory, entry.name);
    if (!entry.name.endsWith('.json')) {
      diagnostics.push({ severity: 'warning', code: 'ignored_file', message: `Ignored non-JSON file in ${kind} directory.`, source });
      continue;
    }
    const parsed = parseObjectFile(source, diagnostics, `${kind} file`);
    if (parsed.value) result.set(path.basename(entry.name, '.json'), { value: parsed.value, source });
  }
  return result;
}

function inlineEntries(value: unknown, source: string, field: string, diagnostics: ConfigDiagnostic[]) {
  const result = new Map<string, { value: Record<string, unknown>; source: string }>();
  if (value === undefined) return result;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    diagnostics.push({ severity: 'error', code: 'invalid_shape', message: `"${field}" must be an object.`, source });
    return result;
  }
  for (const [name, item] of Object.entries(value)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      diagnostics.push({ severity: 'error', code: 'invalid_shape', message: `${field}.${name} must be an object.`, source });
    } else {
      result.set(name, { value: item as Record<string, unknown>, source: `${source}#/${field}/${name}` });
    }
  }
  return result;
}

function overlay<T>(target: Map<string, T>, entries: Map<string, T>, diagnostics: ConfigDiagnostic[], kind: string) {
  for (const [name, entry] of entries) {
    const previous = target.get(name) as { source?: string } | undefined;
    if (previous?.source) {
      diagnostics.push({ severity: 'warning', code: 'shadowed_configuration', message: `${kind} "${name}" overrides ${previous.source}.`, source: (entry as { source?: string }).source });
    }
    target.set(name, entry);
  }
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function diagnoseConfig(cwd = process.cwd()): Promise<ConfigDoctorReport> {
  const diagnostics: ConfigDiagnostic[] = [];
  const globalConfigPath = resolveHomePath('~/.config/karl/karl.json');
  const projectConfigPath = path.join(cwd, '.karl.json');
  const providersDirectory = resolveHomePath('~/.config/karl/providers');
  const modelsDirectory = resolveHomePath('~/.config/karl/models');
  const globalStacksDirectory = resolveHomePath('~/.config/karl/stacks');
  const projectStacksDirectory = path.join(cwd, '.karl', 'stacks');

  const globalFile = parseObjectFile(globalConfigPath, diagnostics, 'Global config');
  const projectFile = parseObjectFile(projectConfigPath, diagnostics, 'Project config');
  const providers = new Map<string, { value: Record<string, unknown>; source: string }>();
  const models = new Map<string, { value: Record<string, unknown>; source: string }>();
  const stacks = new Map<string, { value: Record<string, unknown>; source: string }>();

  if (globalFile.value) {
    overlay(providers, inlineEntries(globalFile.value.providers, globalConfigPath, 'providers', diagnostics), diagnostics, 'Provider');
    overlay(models, inlineEntries(globalFile.value.models, globalConfigPath, 'models', diagnostics), diagnostics, 'Model');
    overlay(stacks, inlineEntries(globalFile.value.stacks, globalConfigPath, 'stacks', diagnostics), diagnostics, 'Stack');
  }
  if (projectFile.value) {
    overlay(providers, inlineEntries(projectFile.value.providers, projectConfigPath, 'providers', diagnostics), diagnostics, 'Provider');
    overlay(models, inlineEntries(projectFile.value.models, projectConfigPath, 'models', diagnostics), diagnostics, 'Model');
    overlay(stacks, inlineEntries(projectFile.value.stacks, projectConfigPath, 'stacks', diagnostics), diagnostics, 'Stack');
  }
  overlay(providers, scanDirectory(providersDirectory, 'providers', diagnostics), diagnostics, 'Provider');
  overlay(models, scanDirectory(modelsDirectory, 'models', diagnostics), diagnostics, 'Model');
  overlay(stacks, scanDirectory(globalStacksDirectory, 'stacks', diagnostics), diagnostics, 'Stack');
  overlay(stacks, scanDirectory(projectStacksDirectory, 'stacks', diagnostics), diagnostics, 'Stack');

  let config: KarlConfig | null = null;
  if (!diagnostics.some(item => item.severity === 'error' && [globalConfigPath, projectConfigPath].includes(item.source ?? ''))) {
    try {
      config = await loadConfig(cwd);
    } catch (error) {
      diagnostics.push({ severity: 'error', code: 'config_load_failed', message: error instanceof Error ? error.message : String(error) });
    }
  }
  const defaultModel = config?.defaultModel || stringField(projectFile.value?.defaultModel) || stringField(globalFile.value?.defaultModel);
  if (defaultModel && !models.has(defaultModel)) {
    diagnostics.push({ severity: 'error', code: 'missing_default_model', message: `Default model "${defaultModel}" is not configured.` });
  }

  const effectiveProviders = [...providers.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, entry]) => {
    const authType: 'oauth' | 'api_key' = entry.value.authType === 'oauth' ? 'oauth' : 'api_key';
    let ready = false;
    let detail: string;
    if (!stringField(entry.value.type)) {
      diagnostics.push({ severity: 'error', code: 'invalid_provider', message: `Provider "${name}" requires a non-empty type field.`, source: entry.source });
    }
    if (authType === 'oauth') {
      const storageKey = getOAuthStorageKey(name);
      const credentials = loadOAuthCredentials(storageKey);
      const supported = storageKey === 'anthropic';
      ready = supported && credentials !== null && !isOAuthCredentialsExpired(credentials);
      detail = !supported ? 'OAuth is unsupported for this provider' : credentials === null ? 'login required' : ready ? 'credentials present and unexpired' : 'credentials expired';
    } else {
      const rawKey = stringField(entry.value.apiKey);
      const references = rawKey ? [...rawKey.matchAll(/\$\{([^}:]+)(?::-([^}]*))?\}/g)].map(match => ({ name: match[1], fallback: match[2] })) : [];
      const unresolved = references.filter(reference => !process.env[reference.name] && reference.fallback === undefined).map(reference => reference.name);
      ready = rawKey !== null && unresolved.length === 0;
      detail = rawKey === null ? 'API key not configured' : unresolved.length ? `environment variable not set: ${unresolved.join(', ')}` : references.length ? 'API key available from environment or configured fallback' : 'API key configured';
    }
    if (!ready) diagnostics.push({ severity: 'warning', code: 'authentication_not_ready', message: `Provider "${name}" is not authentication-ready: ${detail}.`, source: entry.source });
    return { name, source: entry.source, auth: { method: authType, ready, detail } };
  });

  const effectiveModels = [...models.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, entry]) => {
    const provider = stringField(entry.value.provider) ?? '';
    const model = stringField(entry.value.model) ?? '';
    let valid = true;
    if (!provider || !model) {
      valid = false;
      diagnostics.push({ severity: 'error', code: 'invalid_model', message: `Model "${name}" requires non-empty provider and model fields.`, source: entry.source });
    } else if (!providers.has(provider)) {
      valid = false;
      diagnostics.push({ severity: 'error', code: 'missing_provider', message: `Model "${name}" references missing provider "${provider}".`, source: entry.source });
    }
    return { name, source: entry.source, provider, model, valid };
  });

  const skillExists = (name: string) => [resolveHomePath(`~/.config/karl/skills/${name}/SKILL.md`), path.join(cwd, '.karl', 'skills', name, 'SKILL.md')].some(existsSync);
  const stackValidity = new Map<string, boolean>();
  const validateStack = (name: string, trail: string[] = []): boolean => {
    if (stackValidity.has(name)) return stackValidity.get(name)!;
    const entry = stacks.get(name);
    if (!entry) return false;
    if (trail.includes(name)) {
      diagnostics.push({ severity: 'error', code: 'stack_inheritance_cycle', message: `Stack inheritance cycle: ${[...trail, name].join(' -> ')}.`, source: entry.source });
      stackValidity.set(name, false);
      return false;
    }
    let valid = true;
    for (const field of ['extends', 'model', 'skill', 'context', 'contextFile'] as const) {
      if (entry.value[field] !== undefined && typeof entry.value[field] !== 'string') {
        diagnostics.push({ severity: 'error', code: 'invalid_stack_field', message: `Stack "${name}" field "${field}" must be a string.`, source: entry.source });
        valid = false;
      }
    }
    for (const field of ['temperature', 'timeout', 'maxTokens'] as const) {
      if (entry.value[field] !== undefined && typeof entry.value[field] !== 'number') {
        diagnostics.push({ severity: 'error', code: 'invalid_stack_field', message: `Stack "${name}" field "${field}" must be a number.`, source: entry.source });
        valid = false;
      }
    }
    for (const field of ['unrestricted', 'noTools', 'cacheControl'] as const) {
      if (entry.value[field] !== undefined && typeof entry.value[field] !== 'boolean') {
        diagnostics.push({ severity: 'error', code: 'invalid_stack_field', message: `Stack "${name}" field "${field}" must be a boolean.`, source: entry.source });
        valid = false;
      }
    }
    if (entry.value.tools !== undefined && (!Array.isArray(entry.value.tools) || entry.value.tools.some(tool => typeof tool !== 'string'))) {
      diagnostics.push({ severity: 'error', code: 'invalid_stack_field', message: `Stack "${name}" field "tools" must be an array of strings.`, source: entry.source });
      valid = false;
    }
    const parent = stringField(entry.value.extends);
    if (parent && !stacks.has(parent)) {
      diagnostics.push({ severity: 'error', code: 'missing_parent_stack', message: `Stack "${name}" extends missing stack "${parent}".`, source: entry.source });
      valid = false;
    } else if (parent && !validateStack(parent, [...trail, name])) valid = false;
    const model = stringField(entry.value.model);
    if (model && !models.has(model)) {
      diagnostics.push({ severity: 'error', code: 'missing_stack_model', message: `Stack "${name}" references missing model "${model}".`, source: entry.source });
      valid = false;
    }
    const skill = stringField(entry.value.skill);
    if (skill && !skillExists(skill)) {
      diagnostics.push({ severity: 'error', code: 'missing_stack_skill', message: `Stack "${name}" references missing skill "${skill}".`, source: entry.source });
      valid = false;
    }
    stackValidity.set(name, valid);
    return valid;
  };
  const effectiveStacks = [...stacks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, entry]) => ({
    name,
    source: entry.source,
    model: stringField(entry.value.model),
    extends: stringField(entry.value.extends),
    skill: stringField(entry.value.skill),
    valid: validateStack(name),
  }));

  const sandbox = isSandboxAvailable();
  if (!sandbox.available) diagnostics.push({ severity: 'warning', code: 'sandbox_unavailable', message: sandbox.message ?? 'Restricted bash sandbox is unavailable.' });
  diagnostics.sort((a, b) => `${a.severity}:${a.code}:${a.source ?? ''}:${a.message}`.localeCompare(`${b.severity}:${b.code}:${b.source ?? ''}:${b.message}`));
  const errors = diagnostics.filter(item => item.severity === 'error').length;
  const warnings = diagnostics.length - errors;
  return {
    schemaVersion: 1,
    ok: errors === 0,
    sources: {
      precedence: ['defaults', 'global config', 'project config', 'provider/model directories', 'global stacks directory', 'project stacks directory'],
      globalConfig: { path: globalConfigPath, exists: globalFile.exists },
      projectConfig: { path: projectConfigPath, exists: projectFile.exists },
      providersDirectory,
      modelsDirectory,
      globalStacksDirectory,
      projectStacksDirectory,
    },
    effective: { defaultModel: defaultModel ?? null, providers: effectiveProviders, models: effectiveModels, stacks: effectiveStacks },
    sandbox: { platform: sandbox.platform, available: sandbox.available, detail: sandbox.available ? 'restricted bash sandbox is ready' : (sandbox.message ?? 'unavailable') },
    diagnostics,
    summary: { errors, warnings },
  };
}

export function printConfigDoctorReport(report: ConfigDoctorReport): void {
  console.log(`Configuration doctor: ${report.ok ? 'OK' : 'ERRORS FOUND'}`);
  console.log(`Default model: ${report.effective.defaultModel ?? '(none)'}`);
  console.log(`Providers: ${report.effective.providers.length}, models: ${report.effective.models.length}, stacks: ${report.effective.stacks.length}`);
  console.log(`Sources: global ${report.sources.globalConfig.exists ? report.sources.globalConfig.path : '(not found)'}, project ${report.sources.projectConfig.exists ? report.sources.projectConfig.path : '(not found)'}`);
  for (const provider of report.effective.providers) {
    console.log(`  provider ${provider.name}: ${provider.auth.ready ? 'ready' : 'not ready'} (${provider.auth.method}; ${provider.source})`);
  }
  for (const model of report.effective.models) {
    console.log(`  model ${model.name}: ${model.provider}/${model.model} (${model.valid ? 'valid' : 'invalid'}; ${model.source})`);
  }
  for (const stack of report.effective.stacks) {
    const references = [`model=${stack.model ?? '(inherited/default)'}`, stack.extends ? `extends=${stack.extends}` : null, stack.skill ? `skill=${stack.skill}` : null].filter(Boolean).join(', ');
    console.log(`  stack ${stack.name}: ${references} (${stack.valid ? 'valid' : 'invalid'}; ${stack.source})`);
  }
  console.log(`Sandbox (${report.sandbox.platform}): ${report.sandbox.available ? 'ready' : 'unavailable'}${report.sandbox.available ? '' : ` — ${report.sandbox.detail}`}`);
  if (report.diagnostics.length) {
    console.log('Diagnostics:');
    for (const item of report.diagnostics) console.log(`  ${item.severity.toUpperCase()} [${item.code}] ${item.message}${item.source ? ` (${item.source})` : ''}`);
  } else {
    console.log('Diagnostics: none');
  }
  console.log(`Summary: ${report.summary.errors} error(s), ${report.summary.warnings} warning(s)`);
}
