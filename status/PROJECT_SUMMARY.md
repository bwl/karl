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
