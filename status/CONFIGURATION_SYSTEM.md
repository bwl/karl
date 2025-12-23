# Configuration System

Config loading, stacks, providers, models, and precedence rules.

---

## Config Locations

| Type | Global | Project |
|------|--------|---------|
| Main config | `~/.config/karl/karl.json` | `.karl.json` |
| Providers | `~/.config/karl/providers/*.json` | - |
| Models | `~/.config/karl/models/*.json` | - |
| Stacks | `~/.config/karl/stacks/*.json` | `.karl/stacks/*.json` |
| Skills | `~/.config/karl/skills/*/` | `.karl/skills/*/` |
| OAuth | `~/.config/karl/oauth.json` | - |

---

## Config Precedence

**Highest to lowest priority:**

1. CLI flags (`--model opus`)
2. Stack config (`stacks/review.json`)
3. Folder-loaded models/providers
4. Project config (`.karl.json`)
5. Global config (`~/.config/karl/karl.json`)
6. Default config (hardcoded)

---

## TypeScript Types

### KarlConfig

```typescript
interface KarlConfig {
  defaultModel: string;
  models: Record<string, ModelConfig>;
  providers: Record<string, ProviderConfig>;
  tools: ToolsConfig;
  retry: RetryConfig;
  history?: HistoryConfig;
  stacks?: Record<string, StackConfig>;
}
```

### RetryConfig

```typescript
interface RetryConfig {
  attempts: number;
  backoff: 'exponential' | 'linear';
}
```

### HistoryConfig

```typescript
interface HistoryConfig {
  enabled?: boolean;
  path?: string;
  maxDiffBytes?: number;
  maxDiffLines?: number;
}
```

### ProviderConfig

```typescript
interface ProviderConfig {
  type: 'anthropic' | 'openai' | 'openrouter' | 'ollama';
  apiKey?: string;           // Supports ${ENV_VAR} syntax
  baseUrl?: string;
  authType?: 'oauth' | 'api_key';
}
```

### ModelConfig

```typescript
interface ModelConfig {
  provider: string;          // Provider key
  model: string;             // Model ID
  maxTokens?: number;
  contextLength?: number;
  description?: string;
}
```

### StackConfig

```typescript
interface StackConfig {
  name?: string;
  extends?: string;          // Parent stack for inheritance
  model?: string;
  temperature?: number;
  timeout?: number;
  maxTokens?: number;
  skill?: string;
  context?: string;
  contextFile?: string;
  unrestricted?: boolean;
}
```

---

## Environment Variable Expansion

API keys support `${VAR_NAME}` syntax with optional defaults:

```json
{
  "apiKey": "${ANTHROPIC_API_KEY}",
  "baseUrl": "${API_URL:-https://api.anthropic.com}"
}
```

Implementation in `config.ts:39-47`:
```typescript
function expandEnv(value: string): string {
  return value.replace(/\$\{([^}:-]+)(?::-([^}]*))?\}/g,
    (_, name, def) => process.env[name] ?? def ?? '');
}
```

---

## Stack Inheritance

Stacks support inheritance via `extends` field:

```json
// ~/.config/karl/stacks/review.json
{
  "extends": "default",
  "model": "opus",
  "skill": "code-review"
}
```

**Resolution (stacks.ts:121-153):**
1. Load child stack
2. Check for `extends` field
3. Detect circular dependencies
4. Load and resolve parent recursively
5. Merge: child overrides parent

**Cycle Detection:**
```typescript
if (visited.has(stack.name)) {
  throw new Error(`Circular inheritance detected`);
}
```

---

## Config Loading

**Function:** `loadConfig(cwd: string)` in `config.ts:53-72`

**Process:**
1. Read global config (`~/.config/karl/karl.json`)
2. Read project config (`.karl.json`)
3. Load models from `~/.config/karl/models/*.json`
4. Load providers from `~/.config/karl/providers/*.json`
5. Expand environment variables in providers
6. Deep merge all layers

```typescript
let merged = deepMerge(DEFAULT_CONFIG, globalConfig);
merged = deepMerge(merged, projectConfig);
merged.models = { ...merged.models, ...models };
merged.providers = { ...merged.providers, ...providers };
```

---

## Model Resolution

**Function:** `resolveModel(config, options)` in `config.ts:83-126`

**Logic:**
1. If `options.model` is a configured alias -> use that
2. If `options.model` is a direct model ID -> find matching provider
3. Otherwise -> use `config.defaultModel`

**Returns:**
```typescript
{
  model: string;              // Actual model ID
  providerKey: string;        // Provider name
  providerConfig: ProviderConfig;
  maxTokens?: number;
  contextLength?: number;
}
```

---

## Validation

**Function:** `isConfigValid(config)` in `config.ts:148-165`

**Checks:**
- At least one provider has valid credentials
- OAuth providers: check for tokens in credential store
- API key providers: check if key is set and expanded

---

## OAuth Credentials

**Storage:** `~/.config/karl/oauth.json` (mode `0600`)

**Fallback:** `~/.pi/agent/oauth.json` (pi compatibility)

**Schema:**
```typescript
interface OAuthCredentials {
  type: 'oauth';
  refresh: string;
  access: string;
  expires: number;    // Unix timestamp
}
```

**Auto-refresh (oauth.ts:187-209):**
```typescript
if (Date.now() >= creds.expires) {
  const newCreds = await refreshAnthropicToken(creds.refresh);
  saveOAuthCredentials('anthropic', newCreds);
  return newCreds.access;
}
```

---

## Default Configuration

```typescript
const DEFAULT_CONFIG: KarlConfig = {
  defaultModel: '',
  models: {},
  providers: {},
  tools: {
    enabled: ['bash', 'read', 'write', 'edit'],
    custom: ['~/.config/karl/tools/*.ts']
  },
  retry: {
    attempts: 3,
    backoff: 'exponential'
  },
  history: {
    enabled: true,
    path: '~/.config/karl/history/history.db',
    maxDiffBytes: 20000,
    maxDiffLines: 400
  }
};
```

---

## Example Configs

### Provider (`providers/anthropic.json`)
```json
{
  "type": "anthropic",
  "apiKey": "${ANTHROPIC_API_KEY}"
}
```

### Model (`models/sonnet.json`)
```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514",
  "maxTokens": 8192,
  "contextLength": 200000
}
```

### Stack (`stacks/review.json`)
```json
{
  "extends": "default",
  "model": "opus",
  "skill": "code-review",
  "context": "Be thorough but concise"
}
```
