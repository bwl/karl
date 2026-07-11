import { spawnSync } from 'child_process';
import type { ProviderConfig } from './types.js';

export const CODEX_PROVIDER_KEY = 'codex';
export const CODEX_PROVIDER_CONFIG: ProviderConfig = {
  type: 'codex',
  authType: 'codex',
};

export interface CodexProviderStatus {
  installed: boolean;
  authenticated: boolean;
  detail: string;
}

export function isCodexProvider(provider: ProviderConfig | undefined): boolean {
  return provider?.type === 'codex' || provider?.authType === 'codex';
}

export function getCodexProviderStatus(): CodexProviderStatus {
  const version = spawnSync('codex', ['--version'], { encoding: 'utf8' });
  if (version.error || version.status !== 0) {
    return {
      installed: false,
      authenticated: false,
      detail: 'Codex CLI not installed',
    };
  }

  const login = spawnSync('codex', ['login', 'status'], { encoding: 'utf8' });
  const authenticated = !login.error && login.status === 0;
  return {
    installed: true,
    authenticated,
    detail: authenticated ? 'ready' : 'run `codex login`',
  };
}

