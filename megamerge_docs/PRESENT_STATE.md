# Karl Present State Report

> A comprehensive inventory of Karl's current architecture, capabilities, developer experience, and technical status.

**Generated:** 2025-12-20 12:48:00

---


---

# Karl Present State - Overview

This document provides an inventory of Karl's current architecture, capabilities, and development status.

## Table of Contents

1. [Project Overview](#project-overview)
2. [Architecture](#architecture)
3. [Developer Experience & Branding](#developer-experience--branding)
4. [Build & Quality](#build--quality)

---

## Project Overview

### PROJECT_SUMMARY.md
High-level project overview: TypeScript CLI, Bun runtime, active development, key dependencies.

---

## Architecture

### CLI_ARCHITECTURE.md
Core execution engine in `packages/karl/src/`: cli.ts, runner.ts, scheduler.ts, tools.ts, state.ts.

### CLI_COMMANDS.md
Interactive CLI wizards in `packages/karl/src/commands/`: init, providers, models, stacks, skills.

### CONFIGURATION_SYSTEM.md
Config loading, stacks, providers, models, precedence rules, environment variable expansion.

### EXTENSIBILITY.md
Agent Skills standard implementation, hooks system, custom tools, extension points.

---

## Developer Experience & Branding

### DEVELOPER_EXPERIENCE.md
CLI commands inventory, flags, help text quality, error messages, documentation coverage.

### BRANDING_AUDIT.md
Tennis theme implementation, visual identity, messaging patterns, output formatting.

---

## Build & Quality

### BUILD_AND_DEPLOYMENT.md
Monorepo structure, Bun commands, dependencies, packaging.

### CODE_QUALITY.md
Testing coverage, type safety, patterns, documentation gaps.

### TECHNICAL_DEBT.md
Known issues, open questions, refactoring opportunities.

---

## Quick Reference

| Document | Focus | Key Area |
|----------|-------|----------|
| PROJECT_SUMMARY | Overview | Tech stack, entry points |
| CLI_ARCHITECTURE | Core | Execution engine |
| CLI_COMMANDS | Wizards | Interactive commands |
| CONFIGURATION_SYSTEM | Config | Stacks, providers, models |
| EXTENSIBILITY | Plugins | Skills, hooks, tools |
| DEVELOPER_EXPERIENCE | UX | Commands, help, errors |
| BRANDING_AUDIT | Identity | Tennis theme, messaging |
| BUILD_AND_DEPLOYMENT | DevOps | Build, deps, packaging |
| CODE_QUALITY | Quality | Tests, types, patterns |
| TECHNICAL_DEBT | Debt | Issues, gaps, TODOs |


---

<!-- BEGIN: PROJECT_SUMMARY.md -->

# Project Summary

High-level overview of Karl: an AI agent CLI with Agent Skills and Config Stacks.

---

## Overview

Karl is a high-performance, Bun-powered CLI tool designed for rapid LLM queries and parallel task execution. Named after tennis ace Ivo Karlovic, it embodies the "serve and volley" philosophy - fast, one-shot responses without multi-turn sessions.

**Repository:** `/Users/bwl/Developer/karl`
**Main Package:** `packages/karl/`
**Version:** 0.1.0

---

## Tech Stack

### Runtime & Language

| Component | Version | Purpose |
|-----------|---------|---------|
| **Bun** | 1.1.0+ | JavaScript runtime |
| **TypeScript** | ^5.5.0 | Type-safe development |
| **Node Target** | ES2022 | Modern JavaScript features |
| **Module System** | ES2022 (ESM) | Native ES modules |

### Core Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| **@mariozechner/pi-ai** | ^0.23.4 | LLM provider abstraction |
| **@mariozechner/pi-agent-core** | ^0.23.4 | Agent loop and tool execution |
| **@sinclair/typebox** | ^0.34.0 | Runtime type validation |

---

## Project Structure

```
karl/
├── packages/
│   └── karl/                    # Main CLI package (~6,100 LOC)
│       ├── src/                 # Source code (22 TypeScript files)
│       ├── dist/                # Compiled binaries
│       ├── examples/            # Example skills
│       └── scripts/             # Test scripts
├── scripts/                     # Build utilities
├── ideas/                       # Feature exploration docs
├── status/                      # Project documentation
└── .karl/                       # Local configuration
```

### Source Code Breakdown

| File | Lines | Purpose |
|------|------:|---------|
| `cli.ts` | 796 | Main CLI entry, command routing |
| `commands/models.ts` | 588 | Model management |
| `commands/providers.ts` | 543 | Provider management |
| `commands/skills.ts` | 411 | Agent Skills implementation |
| `tools.ts` | 401 | Built-in tools (bash, read, write, edit) |
| `commands/stacks.ts` | 364 | Stack management |
| `spinner.ts` | 360 | TUI spinner and progress |
| `skills.ts` | 343 | Skills loader and validator |
| `runner.ts` | 301 | Task execution via pi-ai |
| `scheduler.ts` | 109 | Parallel task scheduler |

---

## Entry Points

### CLI Binary

**Package.json Definition:**
```json
{
  "bin": {
    "karl": "./dist/karl"
  }
}
```

**Compiled Binary:** `packages/karl/dist/karl`
- Size: ~62 MB (single-file executable)
- Format: Bun compiled binary
- Platform: macOS (darwin arm64)

---

## Build System

### TypeScript Configuration

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "strict": true,
    "types": ["bun-types"]
  }
}
```

### Build Scripts

```bash
bun run dev       # Run from source
bun run build     # Compile standalone binary
bun run typecheck # Type check only
```

---

## Architecture Highlights

### Command Routing

**Built-in Commands:** `run`, `init`, `providers`, `models`, `stacks`, `skills`, `info`

**Stack-as-Verb:** Unknown commands become stack lookups:
- `karl review "code"` -> `karl --stack review "code"`

### Configuration System

**Hierarchy (highest priority first):**
1. CLI flags
2. Stack config
3. Folder-loaded models/providers
4. Project config (`.karl.json`)
5. Global config (`~/.config/karl/karl.json`)
6. Defaults

### Tool System

**Built-in Tools:**
1. `bash` - Shell command execution
2. `read` - File reading (text + images)
3. `write` - File creation
4. `edit` - Find/replace text modifications

### Agent Skills

Implements the [Agent Skills](https://agentskills.io) open standard:
- Global: `~/.config/karl/skills/`
- Project: `./.karl/skills/`

---

## Key Features

### Parallel Execution (Volley Mode)

- Worker pool (default: 3 concurrent)
- Automatic retry with exponential backoff
- Rate limit handling (429 errors)

### OAuth Authentication

- PKCE flow for Anthropic Claude
- Automatic token refresh
- Secure credential storage (`chmod 0600`)

### Config Stacks

Named configurations bundling model, skills, and context:
```json
{
  "model": "haiku",
  "skill": "code-review",
  "context": "Be thorough but concise"
}
```

---

## Summary

Karl is a well-structured TypeScript CLI built on Bun for high-performance LLM task execution. Key strengths:

- **Fast startup** - Bun runtime
- **Parallel execution** - Volley scheduler
- **Extensible** - Skills, hooks, custom tools
- **Ergonomic** - Stack-as-verb pattern

**Total:** ~6,100 lines across 22 TypeScript files

<!-- END: PROJECT_SUMMARY.md -->


---

<!-- BEGIN: CLI_ARCHITECTURE.md -->

# CLI Architecture

Core execution engine implementation in `packages/karl/src/`.

---

## Module Dependency Graph

```
┌─────────────────────────────────────────────────────┐
│                     cli.ts                          │
│              (Entry Point, 797 LOC)                 │
└───────────────┬─────────────────────────────────────┘
                │
                ├──> config.ts (166 LOC) - Load/merge config
                ├──> stacks.ts (288 LOC) - Stack loading
                ├──> context.ts (70 LOC) - System prompt building
                ├──> skills.ts (344 LOC) - Agent Skills
                ├──> hooks.ts (67 LOC) - Hook discovery
                │
                └──> scheduler.ts (110 LOC)
                     │
                     └──> runner.ts (302 LOC)
                          │
                          ├──> tools.ts (402 LOC)
                          └──> state.ts (79 LOC)
```

---

## Core Modules

### 1. cli.ts (Entry Point)

**Purpose:** Command routing, argument parsing, orchestration.

**Key Functions:**
- `main()` (lines 434-791) - Primary entry point
- `parseArgs(argv)` (lines 313-425) - CLI argument parsing
- `runStackCreationWizard()` (lines 65-193) - Interactive stack creation

**Command Dispatch:**
```typescript
if (firstArg === 'run') { /* ... */ }
else if (firstArg === 'init') { await handleInitCommand(); }
else if (BUILTIN_COMMANDS.has(firstArg)) { /* ... */ }
else {
  // Stack-as-verb resolution
  const isStack = await stackExists(firstArg);
  if (isStack) { /* use stack */ }
  else { await runStackCreationWizard(firstArg, args); }
}
```

---

### 2. runner.ts (Task Execution)

**Purpose:** Execute tasks via pi-ai agent loop.

**Key Function:** `runTask(params: RunTaskParams)`

**Control Flow:**
1. Emit `task_start` event
2. Run `pre-task` hooks
3. Build tool array
4. Map provider to pi-ai format
5. Run agent loop with timeout
6. Emit `task_complete` event
7. Run `post-task` hooks

**Timeout Enforcement:**
```typescript
async function runWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs?: number,
  controller?: AbortController
): Promise<T>
```

---

### 3. scheduler.ts (Parallel Execution)

**Purpose:** Manage parallel tasks with retry logic.

**Class:** `VolleyScheduler`

**Work-stealing queue pattern:**
```typescript
while (active < maxConcurrent && queue.length > 0) {
  const item = queue.shift();
  active++;
  runTask(item)
    .catch(error => {
      if (isRetryable(error) && attempt < retryAttempts) {
        queue.push({ ...item, attempt: attempt + 1 });
      }
    })
    .finally(() => { active--; pump(); });
}
```

**Retry Logic:**
- Retryable errors: 408, 429, 500-504, timeouts
- Exponential backoff: 1s -> 2s -> 4s (max 60s)
- Max 3 attempts per task

---

### 4. tools.ts (Tool System)

**Purpose:** Built-in tools and custom tool loading.

**Built-in Tools:**

| Tool | Description |
|------|-------------|
| `bash` | Execute shell commands |
| `read` | Read files (text + images) |
| `write` | Create/overwrite files |
| `edit` | Find/replace text |

**Wrapper Pattern:**
```typescript
function wrapExecute(name, execute, ctx) {
  return async (toolCallId, params) => {
    ctx.onEvent({ type: 'tool_start', ... });
    await ctx.hooks.run('pre-tool', ...);
    try {
      const result = await execute(params);
      await ctx.hooks.run('post-tool', { success: true });
      return result;
    } catch (error) {
      await ctx.hooks.run('on-error', { scope: 'tool' });
      throw error;
    }
  };
}
```

**Sandbox Enforcement:**
```typescript
function assertWithinCwd(resolved: string, cwd: string) {
  if (!resolved.startsWith(cwd + path.sep)) {
    throw new Error(`Operation outside working directory not allowed`);
  }
}
```

---

### 5. state.ts (State Management)

**Purpose:** Event-driven state tracking.

**Functions:**
- `initState(tasks)` - Create initial volley state
- `applyEvent(state, event)` - Reducer for events

**Event Types:**
- `task_start` - Set status to 'running'
- `tool_start` - Add tool to tools array
- `tool_end` - Update tool status
- `task_complete` - Record result
- `task_error` - Record error
- `task_retry` - Reset for retry

---

## Data Structures

### CliOptions
```typescript
interface CliOptions {
  model?: string;
  verbose?: boolean;
  json?: boolean;
  maxConcurrent?: number;
  timeoutMs?: number;
  skill?: string;
  noTools?: boolean;
  unrestricted?: boolean;
  context?: string;
  stack?: string;
  volley?: boolean;
}
```

### TaskResult
```typescript
interface TaskResult {
  task: string;
  status: 'success' | 'error';
  result?: string;
  error?: string;
  durationMs: number;
  toolsUsed: string[];
  tokens?: TokenUsage;
}
```

### SchedulerEvent (Discriminated Union)
```typescript
type SchedulerEvent =
  | { type: 'task_start'; taskIndex: number; task: string; time: number }
  | { type: 'tool_start'; taskIndex: number; tool: string; time: number }
  | { type: 'task_complete'; result: string; durationMs: number; ... }
  | { type: 'task_error'; error: string; durationMs: number; ... }
  | { type: 'task_retry'; attempt: number; delayMs: number; ... };
```

---

## Design Patterns

### 1. Event-Driven State Management
Unidirectional data flow with reducer-style event application.

### 2. Dependency Injection
Pass dependencies as function parameters for testability.

### 3. Wrapper Pattern for Tools
Universal wrapper adds events and hooks to all tool executions.

### 4. Multi-Layer Config Merging
Deep merge with priority: Folder > Project > Global > Default.

### 5. Work-Stealing Queue
Dynamic task distribution with retry queueing.

---

## Control Flow

```
User Input: karl run "task"
     │
     ├─> parseArgs() -> { options, tasks }
     ├─> loadConfig() -> merge configs
     ├─> resolveModel() -> provider & model
     ├─> buildSystemPrompt() -> assemble context
     │
     ├─> scheduler.run([task], runTask)
     │    │
     │    └─> runTask()
     │         ├─> hooks.run('pre-task')
     │         ├─> agentLoop()
     │         │    └─> tool calls
     │         ├─> hooks.run('post-task')
     │         └─> return TaskResult
     │
     └─> printResults()
```

<!-- END: CLI_ARCHITECTURE.md -->


---

<!-- BEGIN: CLI_COMMANDS.md -->

# CLI Commands

Interactive wizard commands in `packages/karl/src/commands/`.

---

## Command Files

| Command | File | Lines | Description |
|---------|------|-------|-------------|
| `init` | `commands/init.ts` | 223 | First-run setup wizard |
| `providers` | `commands/providers.ts` | 544 | Provider management |
| `models` | `commands/models.ts` | 589 | Model management |
| `stacks` | `commands/stacks.ts` | 365 | Stack management |
| `skills` | `commands/skills.ts` | 412 | Skills management |
| `info` | `commands/info.ts` | 217 | System information |
| `run` | `cli.ts` | inline | Execute tasks |

---

## karl init

**Purpose:** First-run setup wizard.

**Creates:**
1. Provider in `~/.config/karl/providers/`
2. Model in `~/.config/karl/models/`
3. Default stack in `~/.config/karl/stacks/default.json`

**Flow:**
```
Available providers:
  1. anthropic - API Key
  2. claude-pro-max - OAuth
  3. openrouter - API Key
  4. openai - API Key

Select provider [1]: 1

Available models:
  1. claude-sonnet-4-20250514
  2. claude-opus-4-20250514

Select model [1]: 1
Model alias [sonnet]:

Setup complete!
```

---

## karl providers

### Subcommands

| Command | Aliases | Description |
|---------|---------|-------------|
| `list` | `ls` | List providers |
| `show` | `info` | Show provider details |
| `add` | `new`, `create` | Add provider (interactive) |
| `remove` | `rm`, `delete` | Remove provider |
| `login` | - | OAuth login |
| `logout` | - | OAuth logout |

### Output Format

```
Found 3 providers:

  anthropic           $ANTHROPIC_API_KEY  ready
  claude-pro-max      OAuth               not authenticated
  openrouter          $OPENROUTER_API_KEY ready
```

---

## karl models

### Subcommands

| Command | Aliases | Flags | Description |
|---------|---------|-------|-------------|
| `list` | `ls` | - | List models |
| `show` | `info` | - | Show model details |
| `add` | `new`, `create` | `--provider`, `--model`, `--default` | Add model |
| `remove` | `rm`, `delete` | - | Remove model |
| `default` | `set-default` | - | Set default model |
| `refresh` | `update` | - | Update OpenRouter metadata |

### Output Format

```
Found 3 models:

  sonnet              anthropic/claude-sonnet-4-20250514
  opus                anthropic/claude-opus-4-20250514
  haiku               anthropic/claude-haiku-3-5-20241022

Default: sonnet
```

---

## karl stacks

### Subcommands

| Command | Aliases | Flags | Description |
|---------|---------|-------|-------------|
| `list` | `ls` | `--verbose` | List stacks |
| `show` | `info` | - | Show stack details |
| `create` | `new` | `--model`, `--skill`, `--global` | Create stack |
| `edit` | - | - | Edit stack ($EDITOR) |
| `remove` | `rm`, `delete` | - | Remove stack |

### Stack Schema

```json
{
  "model": "opus",
  "skill": "code-review",
  "context": "Be thorough but concise",
  "extends": "default",
  "timeout": "30s"
}
```

---

## karl skills

### Subcommands

| Command | Aliases | Flags | Description |
|---------|---------|-------|-------------|
| `list` | `ls` | `--verbose` | List skills |
| `show` | `info` | - | Show skill details |
| `create` | `new` | `--global`, `--project`, `--description` | Create skill |
| `validate` | `check` | - | Validate skill |

### Skill Structure

```
skill-name/
  SKILL.md           # Main definition
  README.md          # Documentation
  scripts/           # Executable scripts
  references/        # Additional docs
  assets/           # Static resources
```

---

## karl run

### Flags

| Flag | Aliases | Type | Description |
|------|---------|------|-------------|
| `--model` | `-m` | string | Model alias or ID |
| `--verbose` | `-v` | boolean | Stream thoughts and tools |
| `--json` | `-j` | boolean | JSON output |
| `--stats` | - | boolean | Print summary stats |
| `--max-concurrent` | - | number | Max parallel tasks (default: 3) |
| `--timeout` | - | duration | Per-task timeout |
| `--skill` | - | string | Load skill by name |
| `--no-tools` | - | boolean | Disable tool use |
| `--unrestricted` | - | boolean | Allow writes outside cwd |
| `--context` | - | string | Extra system prompt |
| `--context-file` | - | path | Context file (use `-` for stdin) |
| `--volley` | - | boolean | Multi-task mode |
| `--dry-run` | - | boolean | Show config only |
| `--stack` | - | string | Stack name |

### Usage Examples

```bash
karl run "fix the bug"
karl run --model opus "explain this code"
karl run --volley "task1" "task2" "task3"
karl run --skill code-review "check auth.ts"
```

---

## Stack-as-Verb Pattern

Unknown commands become stack lookups:

```bash
karl review "check auth.ts"
# Equivalent to:
karl run --stack review "check auth.ts"
```

If stack doesn't exist, offers interactive creation wizard.

---

## karl info

**Human-readable:**
```
Karl v0.1.0

Configuration:
  Global:  ~/.config/karl/karl.json
  Project: ./.karl.json (not found)

Models:
  Default: sonnet
  Configured: sonnet, opus, haiku

Summary:
  Models: 3  Stacks: 5  Skills: 3
```

**JSON output** (`--json`):
```json
{
  "version": "0.1.0",
  "models": { "default": "sonnet", "configured": ["sonnet", "opus"] },
  "counts": { "skills": 3, "stacks": 5, "hooks": 0 }
}
```

---

## Command Registration Pattern

All modules export `handle<Command>Command(args: string[])`:

```typescript
export async function handleModelsCommand(args: string[]) {
  const [command, ...rest] = args;
  switch (command) {
    case 'list':
    case 'ls':
      await listModels();
      break;
    // ...
  }
}
```

<!-- END: CLI_COMMANDS.md -->


---

<!-- BEGIN: CONFIGURATION_SYSTEM.md -->

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
  volley: VolleyConfig;
  stacks?: Record<string, StackConfig>;
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
  volley: {
    maxConcurrent: 3,
    retryAttempts: 3,
    retryBackoff: 'exponential'
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

<!-- END: CONFIGURATION_SYSTEM.md -->


---

<!-- BEGIN: EXTENSIBILITY.md -->

# Extensibility

Agent Skills, hooks, custom tools, and extension points.

---

## Agent Skills

Karl implements the [Agent Skills](https://agentskills.io) open standard.

### Skill Locations

- Global: `~/.config/karl/skills/<name>/`
- Project: `./.karl/skills/<name>/`

### Skill Structure

```
skill-name/
  SKILL.md           # Required: frontmatter + content
  README.md          # Optional: documentation
  scripts/           # Optional: executable scripts
  references/        # Optional: additional docs
  assets/            # Optional: static resources
```

### SKILL.md Format

```markdown
---
name: code-review
description: Review code for security and best practices
license: Apache-2.0
compatibility: karl >= 1.0
metadata:
  author: security-team
  version: "2.1"
allowed-tools: bash read
---

# Code Review Skill

You are a specialized security analyst...
```

### Skill Schema

```typescript
interface SkillMetadata {
  name: string;                    // Required: lowercase-with-hyphens
  description: string;             // Required: max 1024 chars
  license?: string;                // SPDX identifier
  compatibility?: string;          // Version constraint
  metadata?: Record<string, string>;
  'allowed-tools'?: string;        // Space-separated tool names
}
```

### Validation Rules

1. **Name:** Must match `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`
2. **Directory:** Must match skill name exactly
3. **Description:** Non-empty, max 1024 chars

### Loading Resolution

```typescript
const skillsPaths = [
  join(homedir(), '.config', 'karl', 'skills'),  // Global
  join(process.cwd(), '.karl', 'skills'),        // Project
];
```

---

## Hooks System

Lifecycle events for plugins to observe and react.

### Hook Types

```typescript
type HookName =
  | 'pre-task'    // Before task execution
  | 'post-task'   // After task completes
  | 'pre-tool'    // Before tool call
  | 'post-tool'   // After tool call
  | 'on-error';   // On any error
```

### Hook Locations

- Project: `./.karl/hooks/*.{js,ts,mjs,cjs}`
- Global: `~/.config/karl/hooks/*.{js,ts,mjs,cjs}`

### Hook Module Format

```typescript
// ~/.config/karl/hooks/analytics.ts
export default {
  'pre-task': async (event) => {
    console.log(`Starting: ${event.task}`);
  },
  'post-task': async (event) => {
    console.log(`Completed: ${event.result ? 'success' : 'error'}`);
  },
  'on-error': async (event) => {
    console.error(`Error in ${event.scope}: ${event.error}`);
  }
};
```

### Event Schemas

**TaskHookEvent:**
```typescript
{
  task: string;
  index: number;
  attempt: number;
  model: string;
  provider: string;
  result?: string;    // post-task only
  error?: string;     // post-task only
}
```

**ToolHookEvent:**
```typescript
{
  tool: string;
  input: unknown;
  output?: unknown;   // post-tool only
  success?: boolean;  // post-tool only
  error?: string;     // post-tool only
}
```

### Execution Order

```
pre-task hook
  -> For each tool:
     pre-tool hook -> Tool execution -> post-tool hook
  -> (tool calls continue)
post-task hook
on-error hook (if error occurred)
```

---

## Custom Tools

### Built-in Tools

| Tool | Description |
|------|-------------|
| `bash` | Execute shell commands |
| `read` | Read files (text + images) |
| `write` | Create/overwrite files |
| `edit` | Find/replace text |

### Tool Interface

```typescript
interface AgentTool<TParameters, TDetails> {
  name: string;
  label: string;
  description: string;
  parameters: TParameters;  // TypeBox schema
  execute: (
    toolCallId: string,
    params: Static<TParameters>,
    signal?: AbortSignal
  ) => Promise<AgentToolResult<TDetails>>;
}
```

### Custom Tool Definition

```typescript
// ~/.config/karl/tools/screenshot.ts
import { Type } from '@sinclair/typebox';

const schema = Type.Object({
  region: Type.Optional(Type.String()),
  window: Type.Optional(Type.String())
});

export default {
  name: 'screenshot',
  label: 'Screenshot',
  description: 'Capture a screenshot',
  parameters: schema,

  async execute(toolCallId, params) {
    const filename = `/tmp/screenshot-${Date.now()}.png`;
    await captureScreen(params, filename);
    return {
      content: [{ type: 'text', text: `Saved: ${filename}` }],
      details: { path: filename }
    };
  }
};
```

### Tool Loading

```typescript
// From config:
tools: {
  custom: ['~/.config/karl/tools/*.ts']
}
```

Custom tools are loaded via glob patterns and merged with built-ins.

---

## Config Stacks

Named configurations with inheritance.

### Schema

```json
{
  "extends": "default",
  "model": "opus",
  "skill": "code-review",
  "context": "Focus on security",
  "timeout": "30s"
}
```

### Inheritance

```typescript
// Child overrides parent
const resolved = {
  ...parentStack,
  ...childStack  // minus 'extends' field
};
```

Circular dependencies are detected and rejected.

---

## Extension Points Summary

| Extension | Location | Format | Use Case |
|-----------|----------|--------|----------|
| **Skills** | `~/.config/karl/skills/` | YAML + Markdown | Agent personas |
| **Hooks** | `~/.config/karl/hooks/` | JS/TS modules | Observability |
| **Tools** | `~/.config/karl/tools/` | TypeBox + execute | Custom capabilities |
| **Stacks** | `~/.config/karl/stacks/` | JSON with inheritance | Config profiles |

---

## Design Principles

1. **Local-first:** Project overrides global
2. **Graceful degradation:** Invalid extensions log warnings, don't crash
3. **Type safety:** TypeBox schemas for validation
4. **Async-first:** All extensions support async/await
5. **Error isolation:** Extension errors don't fail core operations
6. **Security:** Tools sandboxed to working directory (unless `--unrestricted`)

<!-- END: EXTENSIBILITY.md -->


---

<!-- BEGIN: DEVELOPER_EXPERIENCE.md -->

# Developer Experience

CLI commands, flags, help text, error messages, and documentation.

---

## CLI Structure

```
karl [command|stack-name] [args...] [flags...]

Built-in Commands:
  run, init, providers, models, stacks, skills, info

Stack-as-Verb:
  karl review "task"  ->  karl run --stack review "task"
```

---

## Help Text

```
karl run <task>
karl <command> <task>       (stack as verb)

Built-in Commands:
  run <task>                Run a single task
  init                      First-time setup wizard
  providers                 Manage providers
  models                    Manage models
  stacks                    Manage config stacks
  skills                    Manage agent skills
  info                      Show system info

Your Commands (stacks as verbs):
  karl review <task>  opus::anthropic/claude-opus-4
  karl commit <task>  haiku::anthropic/claude-haiku-3

Flags (use with 'run'):
  --model, -m          Model alias or ID
  --verbose, -v        Stream thoughts and tools
  --json, -j           JSON output
  --skill              Load a skill by name
  --timeout            Per-task timeout
  --volley             Multi-task mode
```

---

## Flag Reference

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--model`, `-m` | string | - | Model alias or ID |
| `--verbose`, `-v` | boolean | false | Stream thoughts/tools |
| `--json`, `-j` | boolean | false | JSON output |
| `--stats` | boolean | false | Print summary |
| `--max-concurrent` | number | 3 | Max parallel tasks |
| `--timeout` | duration | - | Per-task timeout |
| `--skill` | string | - | Skill name |
| `--no-tools` | boolean | false | Disable tools |
| `--unrestricted` | boolean | false | Allow writes outside cwd |
| `--context` | string | - | Extra system prompt |
| `--context-file` | path | - | Context file |
| `--volley` | boolean | false | Multi-task mode |
| `--dry-run` | boolean | false | Show config only |

---

## Error Messages

### Configuration Errors

```
Setup incomplete. Run `karl init` to configure a provider.

No credentials found for provider: anthropic
Set the appropriate API key environment variable.
```

### Command Errors

```
Unknown flag: --invalid

Missing value for --model

Multiple tasks require --volley flag.
  Got: "task1" "task2"
  Use: karl run --volley "task1" "task2" ...
```

### Resource Errors

```
Model "unknown" not found.

Available models:
  - sonnet
  - opus
  - haiku
```

---

## Output Formatting

### Progress Indicator (Spinner)

```
    ○
   /|\   🎾
   / \

  karl is on it... (3.4s)

  ▸ read_file auth.ts
  ✓ grep "password"
```

### Verbose Mode

```
● karl is on it...

  Reading src/auth.ts
  ↳ Found in ./src/auth.ts (47 KB)

▸ read_file
  ✓ read_file done

  Analyzing code structure...

── done in 3.4s ──
```

### JSON Output

```json
{
  "results": [{
    "task": "analyze auth.ts",
    "status": "success",
    "result": "Analysis complete...",
    "tokens": { "input": 1234, "output": 567 },
    "duration_ms": 3421,
    "tools_used": ["read_file", "grep"]
  }],
  "summary": {
    "total": 1,
    "succeeded": 1,
    "failed": 0
  }
}
```

---

## Interactive Prompts

### Yes/No Prompts

```
Create "review" as a new command (stack)? [Y/n]
```

Accepts: `y`, `yes`, `Y`, or empty (default yes)

### Selection Prompts

```
Available providers:
  1. anthropic - API Key
  2. claude-pro-max - OAuth
  3. openrouter - API Key

Select provider [1]:
```

Accepts number or name directly.

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Error (invalid config, task failed, etc.) |

---

## Color Scheme

| Color | Usage |
|-------|-------|
| Green | Success (checkmarks) |
| Red | Errors |
| Cyan | Tool names (verbose) |
| Dim | Thinking text, timestamps |
| Bold | Headers |

Colors disabled if `NO_COLOR` env var is set.

---

## Verbosity Levels

1. **Normal** (default): Spinner with minimal output
2. **Verbose** (`-v`): Streaming thoughts and tool calls
3. **JSON** (`-j`): Structured output for scripting

---

## Dry Run Mode

```
Dry Run Configuration

Provider:     anthropic
Model:        claude-sonnet-4
Model Alias:  sonnet
Auth:         API Key
Skill:        code-review
Stack:        review
Tools:        read, write, edit, bash
Tasks:        1
  - "check auth.ts"
```

---

## Error Handling Patterns

All errors:
1. Print to stderr
2. Set `process.exitCode = 1`
3. Exit gracefully (no stack traces for user errors)

```typescript
export function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return JSON.stringify(error);
}
```

<!-- END: DEVELOPER_EXPERIENCE.md -->


---

<!-- BEGIN: BRANDING_AUDIT.md -->

# Branding Audit

Tennis theme implementation, visual identity, and messaging patterns.

---

## Executive Summary

Karl has **strong conceptual branding** with tennis theming. The "serve-and-volley" philosophy is documented in README and ideas/. However, **implementation is minimal** - the actual CLI uses little tennis terminology beyond "volley" and the spinner animation.

**Score:** 8/10 conceptual, 4/10 implementation

---

## Tennis Theme Usage

### Where Tennis Terms Appear

| Term | Location | Usage |
|------|----------|-------|
| **Volley** | types.ts, scheduler.ts, cli.ts | Parallel execution mode |
| **Tennis Ball** | oauth.ts, spinner.ts | 🎾 emoji in OAuth header and animation |
| **Spinner Animation** | spinner.ts | 18-frame ASCII tennis player |

### Where Tennis Terms Are Missing

| Expected | Current | Gap |
|----------|---------|-----|
| "Serve" for single tasks | "run" | Not implemented |
| "Ace" for success | "✓ Done" | Generic checkmarks |
| "Fault" for errors | "Error:" | No tennis metaphors |
| "Let" for retries | "Retrying..." | Generic messaging |

---

## Name and Brand References

### "Karl" Usage

```typescript
"karl is on it..."           // spinner.ts
"🎾 Karl OAuth Login"        // oauth.ts
"Karl v${version}"           // info.ts
"Welcome to Karl!"           // init.ts
```

**Pattern:** Capitalized "Karl" for entity, lowercase `karl` for commands.

### Configuration Paths

All use `.karl` directory consistently:
- `~/.config/karl/`
- `./.karl/`
- `.karl.json`

---

## Visual Identity

### Spinner Animation (spinner.ts)

18-frame ASCII animation showing tennis player:
- Serve sequence
- Ball in flight
- Diving save
- Victory pose

```
    ○
   /|\   🎾
   / \
```

**Quality:** Excellent - distinctive branding element

### Color Palette

| Color | ANSI | Usage |
|-------|------|-------|
| Green | `\x1b[32m` | Success |
| Red | `\x1b[31m` | Errors |
| Cyan | `\x1b[36m` | Tool names |
| Dim | `\x1b[2m` | Secondary info |
| Bold | `\x1b[1m` | Headers |

### Emoji Usage

- 🎾 Tennis ball (OAuth, spinner)
- ✓ / ✗ Success/failure

**Missing from branding vision:**
- ⚡ Speed/execution
- 🎯 Accuracy/success
- 🏆 Major completion

---

## Messaging Patterns

### Success Messages

**Current:**
```
✓ Model added.
✓ Setup complete!
✓ Stack created.
```

**Branding vision:**
```
🎯 Ace! Model added.
🏆 Setup complete! Ready to serve.
```

### Error Messages

**Current:**
```
Cannot delete the 'default' stack.
Setup incomplete. Run `karl init`.
```

**Missing:**
```
⚠️  Let. Retrying...
❌ Double fault.
🎾 Out. Not found.
```

---

## README vs Implementation

| Vision | Reality |
|--------|---------|
| "One serve. One ace." | Only "volley" exists |
| Tennis-themed commands | Generic "run", "init" |
| Speed references (140mph) | No speed metaphors |
| Easter eggs (--karlovic) | Not implemented |

---

## Recommendations

### Priority 1: Quick Wins

1. **Add "Ace" success messages**
   - "🎯 Ace!" for fast completions
   - "🏆 That's game" for major completions

2. **Add "Serve" messaging**
   - "serving your task..." for single tasks
   - Keep "volleying N tasks..." for parallel

3. **Tennis error messages**
   - "⚠️ Let. Retrying..."
   - "❌ Double fault" for hard failures

### Priority 2: Enhancements

4. **Easter eggs**
   - `--karlovic` flag (ASCII art + random fact)
   - 13,728th task celebration

5. **Enhanced help text**
   - Add tennis flavor
   - "One serve. One ace." tagline

### Priority 3: Future

6. **First-run banner** with ASCII art
7. **Default tennis-themed stacks** (ace, goat, rally)
8. **Stats tracking** (`--ace` flag)

---

## Brand Consistency Matrix

| Element | Vision | Implementation | Score |
|---------|--------|----------------|-------|
| Core Philosophy | ✓ | Partial | 50% |
| Tennis Ball Emoji | ✓ | ✓ | 90% |
| "Volley" Term | ✓ | ✓ | 100% |
| "Serve" Term | ✓ | ✗ | 0% |
| "Ace" Success | ✓ | ✗ | 0% |
| Error Terms | ✓ | ✗ | 0% |
| Spinner Animation | ✓ | ✓ | 100% |
| Easter Eggs | ✓ | ✗ | 0% |

**Overall: 47% implemented**

---

## Conclusion

Karl has **world-class branding vision** documented in ideas/BRANDING.md. The tennis theme is authentic and distinctive. The spinner animation is a standout.

However, only about half of the branding vision is implemented in the CLI. Implementing the full vision would transform Karl from a functional tool to a **memorable, personality-driven developer experience**.

**Estimated effort:** ~10-12 hours for Priority 1-2 items.

<!-- END: BRANDING_AUDIT.md -->


---

<!-- BEGIN: BUILD_AND_DEPLOYMENT.md -->

# Build and Deployment

Monorepo structure, build commands, dependencies, and packaging.

---

## Monorepo Structure

```
karl/
├── package.json                 # Root workspace config
├── bun.lock                     # Bun lockfile (binary)
├── node_modules/               # Shared dependencies
├── packages/
│   └── karl/                   # Main CLI package
│       ├── package.json        # Package metadata
│       ├── tsconfig.json       # TypeScript config
│       ├── src/                # Source files
│       ├── dist/               # Build output
│       └── scripts/            # Test scripts
├── scripts/                    # Repository scripts
├── ideas/                      # Feature docs
└── status/                     # Status docs
```

---

## Package Configuration

### Root package.json

```json
{
  "name": "karl",
  "private": true,
  "packageManager": "bun@1.1.0",
  "workspaces": ["packages/*"],
  "scripts": {
    "dev": "bun run packages/karl/src/cli.ts",
    "build": "bun build packages/karl/src/cli.ts --compile --outfile packages/karl/dist/karl",
    "typecheck": "tsc -p packages/karl/tsconfig.json --noEmit"
  }
}
```

### Karl package.json

```json
{
  "name": "karl-cli",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "karl": "./dist/karl"
  },
  "scripts": {
    "build": "bun build src/cli.ts --target bun --outfile dist/karl",
    "test-skills": "bun run scripts/test-skills.ts"
  },
  "dependencies": {
    "@mariozechner/pi-ai": "^0.23.4",
    "@mariozechner/pi-agent-core": "^0.23.4",
    "@sinclair/typebox": "^0.34.0"
  },
  "devDependencies": {
    "bun-types": "latest",
    "typescript": "^5.5.0"
  }
}
```

---

## TypeScript Configuration

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["bun-types"],
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"]
}
```

**Key settings:**
- `moduleResolution: "Bundler"` - Modern resolution for Bun
- `types: ["bun-types"]` - Bun runtime types
- `strict: true` - Full TypeScript strictness

---

## Build Commands

### Development Build

```bash
bun run dev
# Runs: bun run packages/karl/src/cli.ts
```

Direct execution from TypeScript source (no compilation).

### Production Build

```bash
bun run build
# Runs: bun build packages/karl/src/cli.ts --compile --outfile packages/karl/dist/karl
```

Creates standalone executable with embedded Bun runtime.

### Type Check

```bash
bun run typecheck
# Runs: tsc -p packages/karl/tsconfig.json --noEmit
```

Type checking only, no JavaScript output.

---

## Build Output

```
packages/karl/dist/
├── karl      # Main binary (59MB)
└── cliffy    # Legacy binary (2.2MB)
```

**Binary details:**
- Format: Mach-O 64-bit executable arm64
- Size: ~59MB (includes Bun runtime)
- Platform: macOS ARM64

---

## Dependencies

### Production

| Package | Version | Purpose |
|---------|---------|---------|
| `@mariozechner/pi-ai` | ^0.23.4 | LLM provider abstraction |
| `@mariozechner/pi-agent-core` | ^0.23.4 | Agent execution framework |
| `@sinclair/typebox` | ^0.34.0 | JSON Schema + types |

### Development

| Package | Version | Purpose |
|---------|---------|---------|
| `bun-types` | latest | Bun TypeScript types |
| `typescript` | ^5.5.0 | Type checker |

### Transitive (Notable)

- `@anthropic-ai/sdk@0.71.2` - Claude API
- `openai@6.10.0` - OpenAI API
- `zod@^3.25.0` - Runtime validation (peer dep)

---

## Packaging Status

### Current State

- **Version:** 0.1.0 (pre-release)
- **Distribution:** Binary only (not on npm)
- **Platform:** macOS ARM64 only

### Future Considerations

**Multi-platform builds:**
```bash
bun build --compile --target=linux-x64 --outfile=dist/karl-linux-x64
bun build --compile --target=darwin-arm64 --outfile=dist/karl-darwin-arm64
bun build --compile --target=darwin-x64 --outfile=dist/karl-darwin-x64
bun build --compile --target=windows-x64 --outfile=dist/karl-windows-x64.exe
```

**NPM publishing (needs):**
- `files` field in package.json
- LICENSE file
- prepublish script

---

## Installation

### Manual (Current)

```bash
# Build
bun run build

# Install globally
cp packages/karl/dist/karl /usr/local/bin/karl
chmod +x /usr/local/bin/karl
```

### From Source

```bash
git clone <repo> karl
cd karl
bun install
bun run build
```

---

## Development Workflow

```bash
# Install dependencies
bun install

# Run in dev mode
bun run dev "hello world"

# Type check
bun run typecheck

# Build binary
bun run build

# Test binary
./packages/karl/dist/karl "2+2"
```

---

## Performance

| Operation | Time |
|-----------|------|
| Dev startup | <100ms |
| Bundle time | ~200ms |
| Binary compile | ~2-3s |
| Type check | ~1-2s |

**Binary size breakdown:**
- Bun runtime: ~40MB
- JavaScript bundle: ~500KB
- Dependencies (bundled): ~18MB
- Total: ~59MB

---

## Scripts Reference

| Location | Script | Description |
|----------|--------|-------------|
| Root | `dev` | Run from source |
| Root | `build` | Compile binary |
| Root | `typecheck` | Type check |
| Package | `build` | Bundle for Bun |
| Package | `test-skills` | Test skills |

---

## Status

- **Runtime:** Bun-first (no Node.js)
- **Build:** Standalone binary with embedded runtime
- **CI/CD:** Not configured
- **Publishing:** Not yet on npm
- **Platforms:** macOS ARM64 only

<!-- END: BUILD_AND_DEPLOYMENT.md -->


---

<!-- BEGIN: CODE_QUALITY.md -->

# Code Quality

Testing coverage, type safety, patterns, and documentation status.

---

## Executive Summary

Karl demonstrates **high type safety** with strict TypeScript, **consistent async patterns**, and **comprehensive error handling**. However, there is **zero test coverage** and minimal inline documentation.

| Category | Score |
|----------|-------|
| Test Coverage | 0/10 |
| Type Safety | 10/10 |
| Error Handling | 9/10 |
| Async Patterns | 10/10 |
| Documentation | 5/10 |
| **Overall** | **6.6/10** |

---

## Testing Status

### Test Files

**Finding:** No test files present.

```bash
packages/karl/**/*.test.ts  # None found
packages/karl/**/*.spec.ts  # None found
```

**No test infrastructure:**
- No test framework configured
- No test scripts in package.json
- No test-related dependencies

### Impact

- No automated regression detection
- Manual verification only
- Difficult refactoring

### Recommendations

1. Add Bun's built-in test runner (`bun test`)
2. Start with core modules: runner, scheduler, config
3. Target 60%+ coverage for business logic

---

## Type Safety

### TypeScript Configuration

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "moduleResolution": "Bundler"
  }
}
```

**Enabled strict checks:**
- `strictNullChecks`
- `strictFunctionTypes`
- `noImplicitAny`
- All other strict mode checks

### Explicit `any` Usage

**Found:** 11 instances (all justified)

| Location | Reason |
|----------|--------|
| `runner.ts:40` | External API (pi-ai usage) |
| `runner.ts:109` | Heterogeneous tool array |
| `skills.ts:112` | YAML frontmatter parsing |
| `tools.ts:74` | Generic tool params |

**Assessment:** Strategic use at API boundaries, followed by runtime validation.

### Type Patterns

- Discriminated unions for events (17 types)
- Comprehensive interface definitions
- Strong function signatures

---

## Code Patterns

### Error Handling

**44 try/catch blocks** across 14 files.

**Custom Error Classes:**
```typescript
class TaskRunError extends Error {
  retryable?: boolean;
  toolsUsed?: string[];
  tokens?: TokenUsage;
}

class TimeoutError extends Error {
  retryable = true;
}
```

**Pattern:** Catch, enrich with context, propagate to scheduler for retry logic.

### Async/Await Usage

**71 async functions** across 17 files.

**Common patterns:**
- Async generators in runner.ts
- Promise.race for timeouts
- Sequential async operations in CLI

**No Promise anti-patterns detected.**

### Module Organization

**Core modules:**
```
src/
├── cli.ts          (797 lines) - Entry point
├── runner.ts       (302 lines) - Task execution
├── scheduler.ts    (110 lines) - Parallel scheduling
├── types.ts        (202 lines) - Type definitions
├── config.ts       (166 lines) - Config loading
├── tools.ts        (402 lines) - Built-in tools
├── skills.ts       (344 lines) - Agent Skills
└── commands/       (6 files) - CLI commands
```

**Import pattern:** Clean ESM, unidirectional dependencies.

---

## Documentation

### JSDoc Coverage

**~96 JSDoc blocks** across 13 files.

**Well-documented:**
- `skills.ts` - 12 blocks
- `commands/models.ts` - 17 blocks
- `commands/init.ts` - 6 blocks

**Minimally documented:**
- `utils.ts` - No JSDoc
- `errors.ts` - No JSDoc
- `state.ts` - No JSDoc

### Inline Comments

**~11% comment density** (404 comment lines / 3500 total)

**Good examples exist but sparse overall.**

### README Files

- No package README in `packages/karl/`
- Root `CLAUDE.md` provides project instructions
- `ideas/` folder has comprehensive feature docs

---

## Patterns Summary

| Pattern | Quality |
|---------|---------|
| Error handling | Comprehensive with custom types |
| Async/await | Consistent, no anti-patterns |
| Module separation | Clean boundaries |
| Type annotations | Full coverage |
| JSDoc | Inconsistent |
| Inline comments | Sparse |

---

## Recommendations

### Critical (P0)

1. **Add test coverage**
   - Core modules: runner, scheduler, config, skills
   - Use Bun's built-in test runner

2. **Create package README**
   - Installation, quick start, API reference

### High Priority (P1)

3. **Increase JSDoc coverage**
   - Document all public functions
   - Add rationale for complex algorithms

4. **Add integration tests**
   - CLI commands end-to-end
   - Stack loading and merging

### Medium Priority (P2)

5. **Improve inline comments**
   - Complex conditionals
   - Non-obvious business logic

6. **Type external APIs**
   - Create types for pi-ai library
   - Replace `any` with union types

---

## Source Metrics

| Metric | Value |
|--------|-------|
| Total source files | 22 |
| Total lines | ~3,500 |
| Command modules | 6 |
| JSDoc blocks | ~96 |
| Try/catch blocks | 44 |
| Async functions | 71 |
| Explicit `any` | 11 |

---

## Conclusion

**Strengths:**
- Strict TypeScript
- Comprehensive error handling
- Clean async patterns
- Well-structured modules

**Gaps:**
- Zero test coverage (critical)
- Inconsistent documentation
- No package README

**Priority:** Add basic test coverage before new features.

<!-- END: CODE_QUALITY.md -->


---

<!-- BEGIN: TECHNICAL_DEBT.md -->

# Technical Debt

Known issues, open questions, and refactoring opportunities.

---

## Type Safety Issues

### Provider Type Mismatches

**Location:** `runner.ts:123,127`

```typescript
// Current workaround:
setApiKey(piAiProvider as any, params.apiKey);
const baseModel = getModel(piAiProvider as any, params.model);
```

**Problem:** Karl's flexible provider names don't match pi-ai's strict `KnownProvider` union.

**Fix:** Create type guard or validate against whitelist.

### Heterogeneous Tool Return Types

**Location:** `tools.ts:312-344`

**Problem:** `read` tool returns different shapes:
- Image: `{ path, encoding: 'base64', mime }`
- Binary: `{ path, encoding: 'base64', bytes }`
- Text: `{ path, encoding: 'utf8', bytes }`

**Fix:** Define discriminated union or split tools.

### Tool Array Type Erasure

**Location:** `tools.ts:399-400`

```typescript
return [bash, read, write, edit] as AgentTool<any, any>[];
```

**Fix:** Define explicit return type with base interface.

---

## Testing & Quality

### Zero Test Coverage

**Impact:** High regression risk, no automated validation.

**Suggested priorities:**
1. `scheduler.ts` - Retry logic
2. `config.ts` - Merging, resolution
3. `utils.ts` - Parsing utilities
4. `skills.ts` - Validation

### No Input Validation

**Locations:**
- `cli.ts:95-102` - Model input
- `skills.ts:287` - Path validation only
- `utils.ts:74-95` - Duration parsing

**Fix:** Add runtime validation (TypeBox/Zod).

---

## Code Smells

### Excessive Console Usage

**200+ console.log/error/warn calls**

**Locations:**
- `commands/models.ts` - 50+
- `commands/providers.ts` - 50+
- Various other files

**Fix:** Create centralized logger abstraction.

### Heavy process.exit Usage

**45+ process.exit(1) calls**

**Locations:**
- Command files (models, providers, stacks, skills)

**Fix:** Throw exceptions, catch at top level.

### Mixed Async/Sync File I/O

**72 synchronous file operations**

**Locations:**
- `skills.ts` - readFileSync, existsSync
- `stacks.ts` - readFileSync, readdirSync
- `oauth.ts` - readFileSync, writeFileSync

**Fix:** Standardize on async operations.

### Large Command Files

| File | Lines |
|------|-------|
| `cli.ts` | 796 |
| `commands/models.ts` | 588 |
| `commands/providers.ts` | 543 |

**Fix:** Extract wizards, split handlers.

---

## Architecture

### Global State Management

**Location:** `stacks.ts:262-268`

```typescript
let defaultManager: StackManager | null = null;
```

**Problem:** Singleton pattern, config changes not reflected.

**Fix:** Remove singleton, use dependency injection.

### Error Handling Inconsistencies

**Three patterns in use:**
1. `throw new Error()` - utils, config, skills
2. `console.error() + process.exit(1)` - commands
3. `try/catch with console.warn` - skills, hooks

**Fix:** Establish consistent pattern.

### Tight Coupling to pi-ai

**Problem:** Core runner.ts tightly coupled with type workarounds.

**Fix:** Create abstraction layer.

---

## Security Concerns

### Path Traversal Risk

**Current protection:**
- `assertWithinCwd()` for write/edit tools

**Gaps:**
- `read` tool doesn't validate paths
- Custom tool paths not validated
- `--context-file` not validated

### Command Injection

**Location:** `tools.ts:153-167`

**Current:** No sanitization (by design - it's a bash tool).

**Fix:** Document security implications clearly.

### Credentials in Environment

**Problem:** Env vars passed to tools.

```typescript
env: { ...process.env, ...env }
```

**Fix:** Filter sensitive vars before passing.

---

## Missing Features

### Skill YAML Parser

**Location:** `skills.ts:112-162`

**Problem:** Simple line-by-line parser, doesn't handle:
- Nested structures
- Arrays
- Edge cases

**Fix:** Use proper YAML library (js-yaml).

### OAuth Error Recovery

**Location:** `oauth.ts:190-209`

**Problem:** Refresh failure returns null silently.

**Fix:** Throw specific error with guidance.

### Stack Inheritance Validation

**Problem:** Validates cycles but not schema correctness.

**Fix:** Validate merged stack schema.

---

## Open Questions

1. **Plugin discovery?** Should Karl auto-discover plugins?
2. **Multi-provider routing?** Fallback, load balancing?
3. **Caching strategy?** Cache LLM responses?

---

## Priority Matrix

### Critical (Before v1.0)

- [ ] Add input validation
- [ ] Write tests for core logic
- [ ] Document security model
- [ ] Fix path traversal gaps

### High Priority (v1.x)

- [ ] Replace console with logger
- [ ] Convert exits to exceptions
- [ ] Add JSDoc to public APIs
- [ ] Fix TypeScript any casts

### Long Term (v2.0)

- [ ] Abstract pi-ai dependency
- [ ] Dependency injection
- [ ] Plugin system design
- [ ] Full async file operations

---

## Summary

| Category | Items |
|----------|-------|
| Type safety | 3 |
| Testing | 2 |
| Code smells | 4 |
| Architecture | 3 |
| Security | 3 |
| Missing features | 3 |
| **Total** | **18+** |

**Most urgent:** Testing and validation infrastructure before v1.0.

<!-- END: TECHNICAL_DEBT.md -->
