/**
 * CLI command for outputting system info as JSON
 * Used by karl-tui to display status information
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { loadConfig } from '../config.js';
import { loadOAuthCredentials } from '../oauth.js';
import { skillManager } from '../skills.js';
import { StackManager } from '../stacks.js';
import { resolveHomePath } from '../utils.js';

export interface InfoOutput {
  version: string;
  config: {
    global_path: string;
    project_path: string;
    global_exists: boolean;
    project_exists: boolean;
  };
  auth: {
    [provider: string]: {
      authenticated: boolean;
      method: 'oauth' | 'api_key' | 'none';
      expires_at?: string;
    };
  };
  models: {
    default: string;
    configured: string[];
  };
  providers: {
    [name: string]: {
      type: string;
      has_key: boolean;
    };
  };
  counts: {
    skills: number;
    stacks: number;
    hooks: number;
    models: number;
  };
}

async function loadVersion(): Promise<string> {
  const pkgPath = new URL('../../package.json', import.meta.url);
  try {
    const content = await Bun.file(pkgPath).text();
    const pkg = JSON.parse(content) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function checkApiKeyPresent(apiKey: string | undefined): boolean {
  if (!apiKey) return false;
  // Check if it's an unexpanded env var
  if (apiKey.includes('${')) return false;
  return true;
}

export async function getInfo(cwd: string): Promise<InfoOutput> {
  const globalPath = resolveHomePath('~/.config/karl/karl.json');
  const projectPath = join(cwd, '.karl.json');

  const config = await loadConfig(cwd);
  const version = await loadVersion();

  // Check auth status for all providers
  const authStatus: InfoOutput['auth'] = {};

  for (const [name, providerConfig] of Object.entries(config.providers ?? {})) {
    if (providerConfig.authType === 'oauth') {
      // OAuth-based provider - check oauth.json for credentials
      const oauthStorageKey = name === 'claude-pro-max' ? 'anthropic' : name;
      const oauthCreds = loadOAuthCredentials(oauthStorageKey);
      if (oauthCreds) {
        authStatus[name] = {
          authenticated: true,
          method: 'oauth',
          expires_at: new Date(oauthCreds.expires).toISOString()
        };
      } else {
        authStatus[name] = {
          authenticated: false,
          method: 'none'
        };
      }
    } else {
      // API key based provider
      if (checkApiKeyPresent(providerConfig.apiKey)) {
        authStatus[name] = {
          authenticated: true,
          method: 'api_key'
        };
      } else {
        authStatus[name] = {
          authenticated: false,
          method: 'none'
        };
      }
    }
  }

  // Provider status
  const providers: InfoOutput['providers'] = {};
  for (const [name, providerConfig] of Object.entries(config.providers ?? {})) {
    let hasAuth = checkApiKeyPresent(providerConfig.apiKey);

    // Also check OAuth credentials for OAuth providers
    if (providerConfig.authType === 'oauth') {
      const oauthStorageKey = name === 'claude-pro-max' ? 'anthropic' : name;
      const oauthCreds = loadOAuthCredentials(oauthStorageKey);
      if (oauthCreds) hasAuth = true;
    }

    providers[name] = {
      type: providerConfig.type ?? 'unknown',
      has_key: hasAuth
    };
  }

  // Get counts
  const skills = await skillManager.listSkills();
  const stackManager = new StackManager(config);
  const stacks = await stackManager.listStacks();

  // Count hooks (check both global and project directories)
  let hookCount = 0;
  const hookPaths = [
    resolveHomePath('~/.config/karl/hooks'),
    join(cwd, '.karl', 'hooks')
  ];
  for (const hookPath of hookPaths) {
    if (existsSync(hookPath)) {
      try {
        const { readdirSync } = await import('fs');
        const files = readdirSync(hookPath);
        hookCount += files.filter(f =>
          f.endsWith('.js') || f.endsWith('.ts') || f.endsWith('.mjs')
        ).length;
      } catch {
        // Ignore read errors
      }
    }
  }

  return {
    version,
    config: {
      global_path: globalPath,
      project_path: projectPath,
      global_exists: existsSync(globalPath),
      project_exists: existsSync(projectPath)
    },
    auth: authStatus,
    models: {
      default: config.defaultModel,
      configured: Object.keys(config.models ?? {})
    },
    providers,
    counts: {
      skills: skills.length,
      stacks: stacks.length,
      hooks: hookCount,
      models: Object.keys(config.models ?? {}).length
    }
  };
}

export async function handleInfoCommand(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const isJson = args.includes('--json') || args.includes('-j');

  const info = await getInfo(cwd);

  if (isJson) {
    console.log(JSON.stringify(info, null, 2));
  } else {
    // Human-readable output
    console.log(`Karl v${info.version}\n`);

    console.log('Configuration:');
    console.log(`  Global:  ${info.config.global_path} ${info.config.global_exists ? '✓' : '(not found)'}`);
    console.log(`  Project: ${info.config.project_path} ${info.config.project_exists ? '✓' : '(not found)'}`);
    console.log('');

    console.log('Authentication:');
    for (const [provider, status] of Object.entries(info.auth)) {
      const icon = status.authenticated ? '✓' : '✗';
      const method = status.method === 'oauth' ? 'OAuth' :
                     status.method === 'api_key' ? 'API Key' : 'Not configured';
      const expires = status.expires_at ? ` (expires: ${new Date(status.expires_at).toLocaleString()})` : '';
      console.log(`  ${provider}: ${icon} ${method}${expires}`);
    }
    console.log('');

    console.log('Models:');
    console.log(`  Default: ${info.models.default}`);
    console.log(`  Configured: ${info.models.configured.join(', ')}`);
    console.log('');

    console.log('Providers:');
    for (const [name, status] of Object.entries(info.providers)) {
      const icon = status.has_key ? '✓' : '✗';
      console.log(`  ${name}: ${icon} (${status.type})`);
    }
    console.log('');

    console.log('Summary:');
    console.log(`  Models: ${info.counts.models}  Stacks: ${info.counts.stacks}  Skills: ${info.counts.skills}  Hooks: ${info.counts.hooks}`);
  }
}
