# Architecture

Inspired by [pi-mono](https://github.com/badlogic/pi-mono), Karl uses a layered monorepo:

```
karl/
├── packages/
│   ├── karl-providers/   # LLM provider abstraction
│   ├── karl-core/        # Agent loop, tool execution
│   ├── karl-tools/       # Built-in tool implementations
│   └── karl-cli/         # CLI interface, volley scheduler
└── plugins/              # Example custom tools
```

## Package Responsibilities

### karl-providers

Clean abstraction over OpenAI, Anthropic, OpenRouter, Ollama, vLLM. Swap providers without touching agent code.

### karl-core

The agent loop: parse response → execute tools → feed result → repeat. No UI concerns.

### karl-tools

Default tools as a separate package. Users can replace entirely or extend.

### karl-cli

The user-facing binary. Volley scheduler, progress display, config loading.

## Versioning

**Lockstep versioning**: All packages share the same version. Bump together, publish together.

## Implementation Stack

- **Language**: TypeScript (Bun runtime for speed)
- **Build**: esbuild for fast bundling
- **Binary**: Bun's single-file compiler
- **Testing**: Vitest, skip LLM tests in CI
- **TUI**: Differential rendering for flicker-free updates

## Design Principles

1. **Speed over features** — Fast startup, minimal deps
2. **Unix philosophy** — One job, compose with pipes
3. **Minimal tools** — 4 core, extend via plugins
4. **No state** — Each run is fresh
5. **Transparent** — Show tools, tokens, cost
6. **Extensible** — Skills, hooks, custom tools
