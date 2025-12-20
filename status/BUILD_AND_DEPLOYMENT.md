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
