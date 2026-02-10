# Ivo — Context Intelligence Engine

Ivo builds token-efficient context from a codebase so AI agents can orient fast without reading full files. Instead of dumping 20 source files into a prompt, Ivo gives you codemaps (function signatures, struct definitions, type declarations — no bodies), targeted keyword snippets, and structural overviews at a fraction of the token cost.

## How It Works

Ivo uses tree-sitter to parse source code into ASTs, then extracts the structural skeleton — every function, class, type, and import — while discarding implementation details. Combined with keyword search, git diff analysis, and configurable strategy pipelines, it assembles the most relevant context for a task within a strict token budget.

Every context assembly is saved with a git-style short hash ID (e.g., `a7b2c3d`) for later retrieval, sharing with subagents, or auditing.

## Supported Languages

Ivo ships with native tree-sitter grammars for:

| Language   | Extensions        | Features                                      |
|------------|-------------------|-----------------------------------------------|
| TypeScript | `.ts`             | Functions, classes, methods, interfaces, types, enums, imports, exports |
| TSX        | `.tsx`             | Same as TypeScript + JSX support              |
| JavaScript | `.js`, `.jsx`, `.mjs`, `.cjs` | Functions, classes, methods, imports, exports |
| Rust       | `.rs`             | Functions, structs, enums, traits, impls, type aliases, modules, use statements |
| Python     | `.py`             | Functions, async functions, classes, imports, decorated definitions |
| Go         | `.go`             | Functions, methods (with receivers), type declarations, imports |

Query patterns also exist for Java, C, C++, C#, Swift, Ruby, and PHP — these will work once their tree-sitter grammars are added as dependencies.

## Commands

### `ivo structure [paths...]`

The most useful orientation command. Produces codemaps for every file — function signatures, class outlines, type definitions — without function bodies.

```sh
ivo structure .              # whole project
ivo structure src/auth/      # specific directory
ivo structure src/lib.rs     # single file
```

### `ivo context "keywords" [--budget N] [--full]`

Keyword-driven context assembly. Searches the codebase, selects relevant files, and mixes full content for high-relevance files with codemaps for peripheral ones. Token-budget aware.

```sh
ivo context "auth, login, session, jwt, token"     # search with synonyms
ivo context "cache, redis, ttl" --budget 16000      # limit tokens
ivo context "database, query" --full                # output inline (no save)
```

Without `--full`, prints a summary and saves the context with a short ID:

```
2225649  19 files  5.9k tokens  (18% of 32.0k)
```

**Keyword tips:** Include synonyms and related terms. Up to 12 keywords are used. Stopwords (`the`, `and`, `for`, etc.) are filtered automatically.

### `ivo bucket "keywords" [--intensity lite|standard|deep]`

Fine-grained multi-strategy context assembly. This is the power-user version of `ivo context` — it exposes the full strategy pipeline.

```sh
ivo bucket "auth, login" --intensity lite --no-interactive
ivo bucket "auth, login" --intensity deep --no-interactive
ivo bucket "api" --strategies skeleton,keyword,symbols
ivo bucket "database" --ui    # interactive TUI
```

### `ivo tree [--depth N] [--folders]`

Directory overview for quick project navigation.

### `ivo search <pattern> [-m path|content|both]`

Unified search across file names and content.

```sh
ivo search "auth"                    # auto-detect mode
ivo search "handleLogin" -m content  # content search
ivo search "*.test.ts" -m path       # file path search
```

### `ivo select <add|set|remove|list|clear> [paths...]`

Manually curate a file selection for use with `ivo context --snapshot`.

```sh
ivo select add src/auth/ src/utils/jwt.ts
ivo select list
ivo context --snapshot    # build context from manual selection
```

## Context Strategies

When using `ivo bucket`, you can control exactly which strategies are used. Strategies are assembled in priority order and fit within the token budget.

| Strategy      | What it does                                        | Default intensity |
|---------------|-----------------------------------------------------|-------------------|
| `inventory`   | Directory tree overview                             | lite+             |
| `skeleton`    | Codemaps for entry points and structural files      | lite+             |
| `keyword`     | Snippet matches for your keywords                   | lite+             |
| `symbols`     | Codemaps for files that matched other strategies    | standard+         |
| `config`      | Configuration files (package.json, go.mod, etc.)    | lite+             |
| `diff`        | Recently changed files (from git)                   | standard+         |
| `ast`         | AST-based codemaps for keyword-matching files       | deep              |
| `complexity`  | Codemaps for the largest/most complex files         | deep              |
| `docs`        | Documentation files (README, CLAUDE.md, etc.)       | deep              |

**Intensity presets:**
- **lite** — `inventory`, `skeleton`, `keyword`, `config`
- **standard** — adds `symbols`, `diff`
- **deep** — adds `ast`, `complexity`, `docs`

### Skeleton detection

The skeleton strategy identifies structural entry points automatically:

- **TypeScript/JavaScript:** `index.ts`, `cli.ts`, `main.ts`, `app.ts`, `server.ts`, `types.ts`
- **Rust:** `lib.rs`, `mod.rs`, `main.rs`
- **Python:** `__init__.py`, `__main__.py`, `app.py`, `setup.py`
- **Go:** `main.go`

Files in `src/`, `lib/`, and `packages/` directories are prioritized.

### Config file detection

Ivo automatically includes relevant config files when the `config` strategy is active:

`package.json`, `tsconfig.json`, `bunfig.toml`, `Cargo.toml`, `pyproject.toml`, `setup.py`, `setup.cfg`, `requirements.txt`, `go.mod`, `go.sum`, `Makefile`, `vite.config.ts`, `vitest.config.ts`, `jest.config.js`, and more.

## Saved Contexts

Every `ivo context` and `ivo bucket` run (without `--full`) saves the result in `.ivo/contexts/` with a 7-character hash ID. IDs support partial matching like git SHAs.

```sh
ivo get --list              # list all saved contexts
ivo get a7b2c3d             # summary + file list
ivo get a7b2c3d --raw       # raw XML content
ivo get a7b2c3d --meta      # just metadata
ivo get a7b2c3d --files     # just file paths
ivo get a7b2c3d --tree      # just the tree section
ivo get a7b --json          # partial ID + JSON output
```

### Pinning

Contexts auto-expire after 24 hours by default (max 50 kept). Pin important contexts to preserve them indefinitely:

```sh
ivo pin a7b2c3d             # pin — survives auto-cleanup
ivo unpin a7b2c3d           # unpin — allows auto-cleanup again
```

Pinned contexts show `[pinned]` in `ivo get --list`.

## Recipes

Recipes are saved bucket configurations for repeatable context-building. They live in `.ivo/recipes/` (project-local, checked first) or `~/.config/ivo/recipes/` (global fallback).

### Saving recipes

```sh
# Onboarding recipe — deep analysis of project structure
ivo recipe save onboard \
  --intensity deep \
  --strategies skeleton,keyword,config \
  --keywords "main, entry, core, init" \
  --description "Deep project onboarding"

# Code review recipe — focus on recent changes
ivo recipe save review \
  --intensity standard \
  --strategies keyword,diff,symbols \
  --pin \
  --description "Review recent changes"

# Global recipe shared across all projects
ivo recipe save debug --intensity deep --global
```

### Running recipes

```sh
ivo recipe run onboard                        # uses recipe's default keywords
ivo recipe run onboard "auth, login, jwt"     # override keywords
ivo recipe run review --full                  # output inline instead of saving
```

### Managing recipes

```sh
ivo recipe list              # list all (project + global)
ivo recipe show onboard      # display full config as JSON
ivo recipe delete onboard    # remove
```

### Recipe options

| Flag              | Description                             |
|-------------------|-----------------------------------------|
| `--intensity`     | `lite`, `standard`, or `deep`           |
| `--strategies`    | Comma-separated strategy list           |
| `--keywords`      | Default keywords (overridable at runtime)|
| `--budget`        | Token budget limit                      |
| `--include`       | Glob patterns to include                |
| `--exclude`       | Glob patterns to exclude                |
| `--pin`           | Auto-pin resulting contexts             |
| `--description`   | Human-readable description              |
| `--global`        | Save to global config instead of project|

## Token Efficiency

Real-world comparison on a medium TypeScript project:

| Approach                         | Tokens  |
|----------------------------------|---------|
| Read all source files            | ~9,000  |
| `ivo bucket --intensity lite`    | ~1,645  |
| `ivo bucket --intensity deep`    | ~5,812  |
| `ivo structure src/`             | ~500    |

## Recommended Workflow

```
1. ivo structure .                              → orient on project shape
2. ivo context "relevant, keywords, synonyms"   → get targeted context + ID
3. Read specific files only for editing          → full content only where needed
```

For recurring tasks, save a recipe:

```
1. ivo recipe save mytask --intensity standard --strategies skeleton,keyword --keywords "..."
2. ivo recipe run mytask                        → one command, consistent results
3. ivo pin <id>                                 → keep important baselines
```
