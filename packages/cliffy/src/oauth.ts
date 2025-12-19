import { createHash, randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'fs';
import path from 'path';
import { resolveHomePath } from './utils.js';

// Anthropic OAuth constants (same as pi)
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const AUTHORIZE_URL = 'https://claude.ai/oauth/authorize';
const TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';
const REDIRECT_URI = 'https://console.anthropic.com/oauth/code/callback';
const SCOPES = 'org:create_api_key user:profile user:inference';

export interface OAuthCredentials {
  type: 'oauth';
  refresh: string;
  access: string;
  expires: number;
}

interface OAuthStorage {
  [provider: string]: OAuthCredentials;
}

function getOAuthPath(): string {
  return resolveHomePath('~/.config/cliffy/oauth.json');
}

function ensureConfigDir(): void {
  const configDir = resolveHomePath('~/.config/cliffy');
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true, mode: 0o700 });
  }
}

function loadStorage(): OAuthStorage {
  const filePath = getOAuthPath();
  if (!existsSync(filePath)) {
    return {};
  }
  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

function saveStorage(storage: OAuthStorage): void {
  ensureConfigDir();
  const filePath = getOAuthPath();
  writeFileSync(filePath, JSON.stringify(storage, null, 2), 'utf-8');
  chmodSync(filePath, 0o600);
}

export function loadOAuthCredentials(provider: string): OAuthCredentials | null {
  // First check Cliffy's own storage
  const storage = loadStorage();
  if (storage[provider]) {
    return storage[provider];
  }
  
  // Fall back to pi's storage if available
  const piOAuthPath = resolveHomePath('~/.pi/agent/oauth.json');
  if (existsSync(piOAuthPath)) {
    try {
      const piStorage = JSON.parse(readFileSync(piOAuthPath, 'utf-8'));
      if (piStorage[provider]) {
        return piStorage[provider];
      }
    } catch {
      // Ignore errors reading pi's storage
    }
  }
  
  return null;
}

export function saveOAuthCredentials(provider: string, creds: OAuthCredentials): void {
  const storage = loadStorage();
  storage[provider] = creds;
  saveStorage(storage);
}

export function removeOAuthCredentials(provider: string): void {
  const storage = loadStorage();
  delete storage[provider];
  saveStorage(storage);
}

function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export interface LoginCallbacks {
  onAuthUrl: (url: string) => void;
  onPromptCode: () => Promise<string>;
}

export async function loginAnthropic(callbacks: LoginCallbacks): Promise<void> {
  const { verifier, challenge } = generatePKCE();

  const authParams = new URLSearchParams({
    code: 'true',
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: verifier
  });

  const authUrl = `${AUTHORIZE_URL}?${authParams.toString()}`;
  callbacks.onAuthUrl(authUrl);

  const authCode = await callbacks.onPromptCode();
  const [code, state] = authCode.split('#');

  const tokenResponse = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code,
      state,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier
    })
  });

  if (!tokenResponse.ok) {
    const error = await tokenResponse.text();
    throw new Error(`OAuth token exchange failed: ${error}`);
  }

  const tokenData = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  const expiresAt = Date.now() + tokenData.expires_in * 1000 - 5 * 60 * 1000;

  saveOAuthCredentials('anthropic', {
    type: 'oauth',
    refresh: tokenData.refresh_token,
    access: tokenData.access_token,
    expires: expiresAt
  });
}

export async function refreshAnthropicToken(refreshToken: string): Promise<OAuthCredentials> {
  const tokenResponse = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: refreshToken
    })
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
    expires: expiresAt
  };
}

/**
 * Get a valid access token, refreshing if needed
 */
export async function getAnthropicAccessToken(): Promise<string | null> {
  const creds = loadOAuthCredentials('anthropic');
  if (!creds) {
    return null;
  }

  // Check if token is expired or about to expire
  if (Date.now() >= creds.expires) {
    try {
      const newCreds = await refreshAnthropicToken(creds.refresh);
      saveOAuthCredentials('anthropic', newCreds);
      return newCreds.access;
    } catch (error) {
      // Refresh failed - credentials are stale
      return null;
    }
  }

  return creds.access;
}

/**
 * Interactive login flow for CLI
 */
export async function runLoginFlow(): Promise<void> {
  const readline = await import('readline');
  const { exec } = await import('child_process');
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (prompt: string): Promise<string> =>
    new Promise((resolve) => rl.question(prompt, resolve));

  console.log('\n🎾 Cliffy OAuth Login\n');
  console.log('This will open your browser to authorize Cliffy with your Claude account.');
  console.log('After authorizing, copy the code and paste it here.\n');

  await loginAnthropic({
    onAuthUrl: (url) => {
      console.log('Opening browser...\n');
      
      // Try to open browser
      const openCmd = process.platform === 'darwin' ? 'open' :
                      process.platform === 'win32' ? 'start' : 'xdg-open';
      exec(`${openCmd} "${url}"`, (error) => {
        if (error) {
          console.log('Could not open browser automatically.');
          console.log('Please open this URL manually:\n');
          console.log(url);
          console.log('');
        }
      });
    },
    onPromptCode: async () => {
      const code = await question('Paste the authorization code here: ');
      rl.close();
      return code.trim();
    }
  });

  console.log('\n✓ Login successful! Credentials saved.\n');
}
