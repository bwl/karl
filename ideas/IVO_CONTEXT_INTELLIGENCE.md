# Ivo: Context Intelligence Engine

> "If Karl is the 140mph serve, Ivo is the elite scout who already knows where to aim."

Named after the legendary **Ivo Karlović**—the towering ace machine—**Ivo** is Karl's sibling who masters the **"Context is King"** philosophy. While Karl focuses on execution (the serve), Ivo manages the **Context Intelligence** that ensures every shot is a clean winner.

---

## The Karl-Ivo Dynamic

**Analogy**: If **Karl** is the champion on the court delivering the 140mph serve, **Ivo** is the **elite scout and coach** sitting in the box. Ivo has already analyzed every inch of the court (the project), studied the opponent's weaknesses (the task), and hand-picked the perfect racket (the context) to ensure that Karl's single shot is a clean winner.

**Karl provides the power; Ivo provides the sight.**

---

## Core Responsibilities

### 1. Context Memory System

Located in `.karl/context/`, Ivo maintains intelligent project awareness:

**Versioned Caching with Merkle Trees**
```
.karl/context/
├── merkle.json           # File change tracking
├── project-graph.json    # Dependency relationships
├── context-cache/        # Versioned context snapshots
│   ├── v1.json
│   ├── v2.json
│   └── current -> v2.json
└── deltas/               # Incremental updates
    └── v1-to-v2.patch
```

**Delta Updates**: Instead of rebuilding context for every task, Ivo performs **incremental updates**, sending only what has changed since the last serve. This significantly reduces token waste and improves response time.

```typescript
interface ContextMemory {
  merkleRoot: string;
  files: Map<string, FileHash>;
  lastUpdated: Date;

  // Only compute what changed
  getDelta(since: string): ContextDelta;

  // Apply incremental updates
  applyDelta(delta: ContextDelta): void;
}
```

### 2. Smart Context Pruning

A **two-pass AI-powered system** prevents "Wall of Text Syndrome" and model degradation:

**Phase 1: Relevance Scoring**
```typescript
interface RelevanceScore {
  file: string;
  score: number;        // 0-1 relevance to current task
  reason: string;       // Why this file matters
  tokens: number;       // Estimated token count
}

async function scoreRelevance(
  task: string,
  files: string[]
): Promise<RelevanceScore[]> {
  // Fast model pass to score each file
  // against the current task
}
```

**Phase 2: Pruning**
- Include **10x more files at 1/10th the cost** using dense "codemaps"
- Generate compressed summaries for low-relevance but useful context
- Full content only for high-relevance files

```typescript
interface PrunedContext {
  fullFiles: string[];      // High relevance: full content
  codemaps: CodeMap[];      // Medium relevance: compressed
  references: string[];     // Low relevance: just paths
  totalTokens: number;
}
```

### 3. "Warm" Project Awareness

Operating as the core of **Daemon Mode (`karld`)**, Ivo maintains **in-memory awareness**:

**Persistent State**
- Parsed file tree
- Dependency graphs
- Active skills
- Common patterns
- Recent changes

**Zero Latency Target**
```bash
# Cold start: 2+ seconds
time karl "explain this function" < utils.ts

# With Ivo warm: ~20ms
time karl "explain this function" < utils.ts
```

By keeping this data warm, Ivo enables Karl to achieve **instant ~20ms response time** by eliminating the 2+ second project scan.

### 4. Unix-Philosophy Streaming

Moving away from "filesystem pollution" and temporary files:

**Memory-Mapped Context**
```bash
# Instead of temp files:
karl --context /tmp/context-abc123.json "fix this"

# Ivo uses named pipes and env vars:
KARL_CONTEXT_FD=3 karl "fix this" 3< <(ivo context --task "fix this")
```

**Security Isolation**: By managing context in memory, Ivo mitigates path traversal risks and security gaps that come with temp file approaches.

### 5. Match Analytics and Learning

While Karl serves the ace, Ivo acts as the analyst tracking **Match Statistics**:

**Metrics Database** (SQLite)
```sql
CREATE TABLE context_metrics (
    id INTEGER PRIMARY KEY,
    task_hash TEXT,
    tokens_sent INTEGER,
    tokens_used INTEGER,
    relevance_accuracy REAL,
    model_used TEXT,
    timestamp TEXT
);

CREATE TABLE file_usage (
    file_path TEXT,
    task_type TEXT,
    usage_count INTEGER,
    avg_relevance REAL
);
```

**Learning Patterns**
- Recognize repeated prompt templates
- Track project-specific file importance
- Offer "Smart Aliases" based on context patterns
- Predict likely context needs for common tasks

---

## Interactive Context Inventory

### The "Pre-Match Lineup"

Before the "serve," Ivo performs a two-pass relevance scan and presents a **Contextual TUI**:

```
╭─ Context Inventory ──────────────────────────────────────────╮
│                                                              │
│  Task: "Fix authentication timeout bug"                      │
│                                                              │
│  ┌─ Proposed Context ───────────────────────────────────┐   │
│  │ [✓] src/auth/login.ts .................. 2.4k tokens │   │
│  │ [✓] src/auth/session.ts ................ 1.8k tokens │   │
│  │ [✓] src/auth/types.ts .................. 0.6k tokens │   │
│  │ [ ] src/auth/oauth.ts .................. 3.2k tokens │   │
│  │ [✓] src/config/timeouts.ts ............. 0.3k tokens │   │
│  │ [ ] tests/auth.test.ts ................. 4.1k tokens │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌─ Window Budget ──────────────────────────────────────┐   │
│  │ ████████████░░░░░░░░░░░░░░░░░░░░  5.1k / 64k tokens  │   │
│  │ [Green Zone]                                          │   │
│  │                                                       │   │
│  │ Est. Cost: $0.003 (sonnet)                           │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  [Space] Toggle  [a] Select All  [Enter] Confirm  [?] Help  │
╰──────────────────────────────────────────────────────────────╯
```

### Live Window Budget

Real-time token counting with visual thresholds:

| Zone | Token Range | Color | Meaning |
|------|-------------|-------|---------|
| Safe | 0 - 30k | Green | Optimal reasoning |
| Caution | 30k - 50k | Yellow | Good, monitor quality |
| Warning | 50k - 64k | Orange | May see degradation |
| Danger | 64k+ | Red | Quality likely impacted |

**Predictive Cost Estimation**: Display live cost based on selected model's pricing.

### Integration with Karl's "Moods"

The interactivity level shifts based on the active **Mood Profile**:

| Mood | Context Behavior |
|------|------------------|
| **Pro** | Always require manual confirmation (zero margin for error) |
| **Zen** | Skip interactive step, rely on automated Smart Pruning |
| **Coach** | Suggest *why* certain blocks included, offer 2-3 strategies |
| **Quick** | Fast auto-pruning with single-key override option |

---

## Persistence and Learning

### Pattern Recognition

Ivo learns which files you frequently deny:

```json
{
  "auto_exclude": [
    "node_modules/**",
    "dist/**",
    "*.test.ts",
    "**/*.spec.ts"
  ],
  "confidence": 0.92,
  "sample_size": 47
}
```

### Context Templates

Save perfected context inventories as named templates:

```bash
# Save current context selection
ivo template save security-audit

# Reuse later
karl --context-template security-audit "Review for vulnerabilities"
```

```json
{
  "name": "security-audit",
  "includes": [
    "src/auth/**/*.ts",
    "src/api/middleware/*.ts",
    ".env.example"
  ],
  "excludes": [
    "**/*.test.ts",
    "**/mock/**"
  ],
  "codemaps": [
    "src/utils/**"
  ]
}
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                         Ivo                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │   Context   │  │  Relevance  │  │     Merkle      │  │
│  │   Memory    │  │   Scorer    │  │   Tree Tracker  │  │
│  └──────┬──────┘  └──────┬──────┘  └────────┬────────┘  │
│         │                │                   │           │
│         └────────────────┼───────────────────┘           │
│                          │                               │
│                    ┌─────┴─────┐                         │
│                    │  Context  │                         │
│                    │ Assembler │                         │
│                    └─────┬─────┘                         │
│                          │                               │
│  ┌─────────────┐  ┌──────┴──────┐  ┌─────────────────┐  │
│  │   Metrics   │  │  Streaming  │  │     Template    │  │
│  │   Tracker   │  │   Output    │  │     Manager     │  │
│  └─────────────┘  └──────┬──────┘  └─────────────────┘  │
└──────────────────────────┼──────────────────────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │    Karl     │
                    │  (Executor) │
                    └─────────────┘
```

---

## Implementation Roadmap

### Phase 1: Core Context Management
- [ ] Merkle tree file tracking
- [ ] Basic relevance scoring (keyword matching)
- [ ] Delta computation and caching
- [ ] Context size estimation

### Phase 2: Smart Pruning
- [ ] AI-powered relevance scoring
- [ ] Codemap generation
- [ ] Configurable pruning strategies
- [ ] Token budget management

### Phase 3: Interactive Inventory
- [ ] TUI for context selection
- [ ] Live budget visualization
- [ ] Mood-based interactivity levels
- [ ] Keyboard shortcuts

### Phase 4: Learning & Templates
- [ ] SQLite metrics storage
- [ ] Pattern recognition
- [ ] Template save/load
- [ ] Auto-exclude learning

### Phase 5: Daemon Integration
- [ ] Integration with `karld`
- [ ] Memory-mapped context streaming
- [ ] Named pipe support
- [ ] Hot context refresh

---

## The Tennis Stringer Analogy

Think of Ivo as a **professional tennis stringer**:

- The **context inventory** is the choice of string and tension
- Without an interactive step, the stringer just guesses what you need
- With Ivo's feature, the equipment (files) is laid out on the bench
- You pick only the best gear
- The **window budget** acts like a tension gauge, ensuring the racket isn't so "tight" (overloaded with tokens) that it loses its "feel" (reasoning capability) during the match

---

## Key Metrics

| Metric | Cold Start | With Ivo |
|--------|------------|----------|
| Project scan | 2+ seconds | ~20ms |
| Context assembly | 500ms | ~50ms |
| Token efficiency | 100% | ~10% (pruned) |
| File coverage | Limited | 10x more |
| Cost per task | $X | $X/10 |

---

## Output Formats

Inspired by tools like [Repomix](https://repomix.com/) and [code2prompt](https://github.com/mufeedvh/code2prompt), Ivo supports multiple output formats optimized for different LLM preferences.

### XML Format (Default for Claude)

Anthropic explicitly recommends XML tags for structuring prompts. Ivo's XML output:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<ivo_context version="1.0" generated="2025-01-15T10:30:00Z">

  <file_summary>
    <task>Fix authentication timeout bug</task>
    <total_files>6</total_files>
    <total_tokens>5100</total_tokens>
    <compression_ratio>0.42</compression_ratio>
    <relevance_threshold>0.65</relevance_threshold>
  </file_summary>

  <directory_structure>
src/
├── auth/
│   ├── login.ts (2.4k tokens, relevance: 0.95)
│   ├── session.ts (1.8k tokens, relevance: 0.88)
│   └── types.ts (0.6k tokens, relevance: 0.72)
└── config/
    └── timeouts.ts (0.3k tokens, relevance: 0.91)
  </directory_structure>

  <files>
    <file path="src/auth/login.ts" tokens="2400" relevance="0.95">
      <content><![CDATA[
// Full file content here
export async function login(credentials: Credentials): Promise<Session> {
  // ...
}
      ]]></content>
    </file>

    <file path="src/auth/session.ts" tokens="1800" relevance="0.88" mode="codemap">
      <codemap><![CDATA[
// Compressed structural summary
exports: [SessionManager, createSession, validateSession]
classes: [SessionManager { constructor, refresh, invalidate }]
functions: [createSession(user) -> Session, validateSession(token) -> boolean]
dependencies: [./types, ../config/timeouts]
      ]]></codemap>
    </file>
  </files>

  <git_context>
    <recent_changes count="3">
      <commit hash="abc123" author="dev" date="2025-01-14">
        Fix session refresh race condition
      </commit>
    </recent_changes>
    <staged_diff><![CDATA[
--- a/src/auth/login.ts
+++ b/src/auth/login.ts
@@ -42,6 +42,7 @@
+  timeout: config.authTimeout,
    ]]></staged_diff>
  </git_context>

  <instructions>
    <system>You are analyzing authentication code to fix a timeout bug.</system>
    <focus>Pay attention to timeout configurations and session lifecycle.</focus>
  </instructions>

</ivo_context>
```

### Markdown Format

Human-readable, good for debugging and manual review:

```markdown
# Context: Fix authentication timeout bug

## Summary
- **Files**: 6 (4 full, 2 codemaps)
- **Tokens**: 5,100 / 64,000 budget
- **Relevance threshold**: 0.65

## Directory Structure
\`\`\`
src/
├── auth/
│   ├── login.ts ★ (2.4k tokens)
│   ├── session.ts ◐ (1.8k tokens, codemap)
│   └── types.ts (0.6k tokens)
└── config/
    └── timeouts.ts ★ (0.3k tokens)
\`\`\`

## Files

### src/auth/login.ts
**Relevance**: 0.95 | **Tokens**: 2,400 | **Mode**: Full

\`\`\`typescript
export async function login(credentials: Credentials): Promise<Session> {
  // Full content...
}
\`\`\`

### src/auth/session.ts
**Relevance**: 0.88 | **Tokens**: 1,800 | **Mode**: Codemap

\`\`\`
exports: [SessionManager, createSession, validateSession]
classes: [SessionManager { constructor, refresh, invalidate }]
\`\`\`
```

### JSON Format

Programmatic access for tooling and pipelines:

```json
{
  "version": "1.0",
  "task": "Fix authentication timeout bug",
  "generated": "2025-01-15T10:30:00Z",
  "summary": {
    "totalFiles": 6,
    "totalTokens": 5100,
    "budget": 64000,
    "compressionRatio": 0.42
  },
  "files": [
    {
      "path": "src/auth/login.ts",
      "tokens": 2400,
      "relevance": 0.95,
      "mode": "full",
      "content": "..."
    },
    {
      "path": "src/auth/session.ts",
      "tokens": 1800,
      "relevance": 0.88,
      "mode": "codemap",
      "codemap": {
        "exports": ["SessionManager", "createSession"],
        "classes": [{"name": "SessionManager", "methods": ["refresh"]}],
        "dependencies": ["./types"]
      }
    }
  ],
  "git": {
    "recentCommits": [...],
    "stagedDiff": "..."
  }
}
```

---

## Configuration

### Configuration File (`ivo.config.ts`)

Ivo uses a TypeScript/JavaScript configuration file for type safety:

```typescript
// .karl/ivo.config.ts
import { defineConfig } from '@karl/ivo';

export default defineConfig({
  // Input settings
  input: {
    maxFileSize: 50_000_000,  // 50MB max per file
    maxTotalSize: 200_000_000, // 200MB total
    followSymlinks: false,
  },

  // Output settings
  output: {
    style: 'xml',  // 'xml' | 'markdown' | 'json' | 'plain'
    filePath: null, // null = stdout, or path for file output

    // Content controls
    showLineNumbers: true,
    removeComments: false,
    removeEmptyLines: false,
    truncateBase64: true,

    // Structure controls
    includeFileSummary: true,
    includeDirectoryStructure: true,
    includeEmptyDirectories: false,
  },

  // Token management
  tokens: {
    encoding: 'o200k_base',  // OpenAI tokenizer
    budget: 64000,           // Effective context window
    warningThreshold: 0.75,  // Warn at 75% of budget

    // Compression
    compress: true,
    compressionStrategy: 'treesitter', // 'treesitter' | 'summary' | 'none'
    codemapThreshold: 0.70,  // Below this relevance, use codemap
  },

  // Relevance scoring
  relevance: {
    model: 'haiku',          // Fast model for scoring
    minScore: 0.40,          // Below this, exclude entirely
    batchSize: 50,           // Files per scoring batch
    cacheResults: true,      // Cache scores for unchanged files
  },

  // Include patterns (glob)
  include: [
    'src/**/*.ts',
    'lib/**/*.ts',
    '*.config.{ts,js}',
    'package.json',
    'tsconfig.json',
  ],

  // Ignore patterns
  ignore: {
    useGitignore: true,
    useDotIgnore: true,
    customPatterns: [
      'node_modules/**',
      'dist/**',
      'build/**',
      '*.test.ts',
      '*.spec.ts',
      '**/__tests__/**',
      '**/*.d.ts',
      '.git/**',
    ],
    useDefaultPatterns: true,
  },

  // Git integration
  git: {
    includeDiffs: true,      // Staged + unstaged changes
    includeLogs: true,       // Recent commit messages
    logsCount: 5,            // Number of commits to include
    sortByChanges: true,     // Prioritize frequently changed files
    sortByChangesMaxCommits: 100,
  },

  // Security
  security: {
    enableSecretScan: true,  // Secretlint integration
    excludePatterns: [
      '**/.env*',
      '**/secrets/**',
      '**/*credential*',
      '**/*password*',
      '**/*.pem',
      '**/*.key',
    ],
    warnOnSensitive: true,
  },

  // Interactive mode
  interactive: {
    enabled: true,
    defaultMood: 'coach',    // 'pro' | 'zen' | 'coach' | 'quick'
    showCostEstimate: true,
    confirmOnLargeBudget: true, // Confirm if >50% budget
  },
});
```

### JSON Configuration Alternative

```json
{
  "$schema": "https://karl.dev/schemas/ivo.config.json",
  "output": {
    "style": "xml",
    "compress": true
  },
  "tokens": {
    "budget": 64000,
    "encoding": "o200k_base"
  },
  "include": ["src/**/*.ts"],
  "ignore": {
    "useGitignore": true,
    "customPatterns": ["*.test.ts"]
  }
}
```

---

## Tree-sitter Code Compression

Ivo uses [Tree-sitter](https://tree-sitter.github.io/) to intelligently compress code while preserving semantic structure. This achieves **~70% token reduction** on average.

### How It Works

```typescript
interface TreeSitterCompressor {
  // Extract structural elements only
  compress(source: string, language: Language): Codemap;
}

interface Codemap {
  // What this file exports
  exports: Export[];

  // Class/interface definitions (signatures only)
  types: TypeDefinition[];

  // Function signatures (no bodies)
  functions: FunctionSignature[];

  // Import dependencies
  dependencies: string[];

  // Key constants and configurations
  constants: Constant[];

  // Estimated token count of compressed form
  tokens: number;
}
```

### Compression Example

**Original (847 tokens):**
```typescript
import { db } from '../database';
import { hash, verify } from '../crypto';
import type { User, Session } from '../types';

export class AuthService {
  private readonly db: Database;
  private readonly sessionTTL = 3600;

  constructor(database: Database) {
    this.db = database;
  }

  async login(email: string, password: string): Promise<Session> {
    const user = await this.db.users.findByEmail(email);
    if (!user) {
      throw new AuthError('User not found');
    }

    const valid = await verify(password, user.passwordHash);
    if (!valid) {
      throw new AuthError('Invalid password');
    }

    const session = await this.createSession(user);
    return session;
  }

  async logout(sessionId: string): Promise<void> {
    await this.db.sessions.delete(sessionId);
  }

  private async createSession(user: User): Promise<Session> {
    const token = crypto.randomUUID();
    const expires = Date.now() + this.sessionTTL * 1000;

    await this.db.sessions.create({
      id: token,
      userId: user.id,
      expiresAt: expires,
    });

    return { token, user, expiresAt: expires };
  }
}
```

**Compressed Codemap (127 tokens, 85% reduction):**
```
file: src/auth/service.ts
dependencies: [../database, ../crypto, ../types]
exports: [AuthService]
classes:
  AuthService:
    properties: [db: Database, sessionTTL: number = 3600]
    methods:
      - login(email: string, password: string): Promise<Session>
      - logout(sessionId: string): Promise<void>
      - private createSession(user: User): Promise<Session>
types_used: [User, Session, Database]
errors_thrown: [AuthError]
```

### Language Support

| Language | Compression | Notes |
|----------|-------------|-------|
| TypeScript/JavaScript | Excellent | Full AST support |
| Python | Excellent | Class/function extraction |
| Rust | Good | Trait/impl extraction |
| Go | Good | Interface/struct extraction |
| Java/Kotlin | Good | Class hierarchy support |
| C/C++ | Moderate | Header-style extraction |
| Others | Basic | Regex-based fallback |

---

## CLI Interface

### Core Commands

```bash
# Generate context for a task
ivo context "Fix the authentication bug"

# Interactive mode (TUI)
ivo context --interactive "Review security"

# Output to file
ivo context -o context.xml "Refactor database layer"

# Pipe to Karl
ivo context "Add caching" | karl run

# Use with specific format
ivo context --style markdown "Document API"
```

### Advanced Usage

```bash
# Specify files via stdin (ripgrep integration)
rg -l "TODO" | ivo context --stdin "Address TODOs"

# Use fzf for file selection
fd -t f | fzf -m | ivo context --stdin "Review selected files"

# Git-aware: only changed files
git diff --name-only | ivo context --stdin "Review my changes"

# With budget constraint
ivo context --budget 32000 "Quick fix"

# Force codemap mode for all files
ivo context --compress-all "Architecture overview"

# Include git context
ivo context --git-logs 10 --git-diff "Understand recent changes"

# Template-based
ivo context --template security-audit "Review auth module"
```

### Output Control

```bash
# Token stats only (no content)
ivo stats src/

# Preview what would be included
ivo preview "Fix bug" --dry-run

# Explain relevance decisions
ivo context --explain "Why these files?"
```

---

## MCP Server Mode

Ivo can run as an MCP (Model Context Protocol) server, exposing context capabilities to AI assistants:

```typescript
// MCP Server Configuration
{
  "mcpServers": {
    "ivo": {
      "command": "ivo",
      "args": ["serve", "--mcp"],
      "env": {
        "IVO_PROJECT": "/path/to/project"
      }
    }
  }
}
```

### Available Tools

```typescript
// Tools exposed via MCP
interface IvoMCPTools {
  // Build context for a task
  'ivo_context': {
    task: string;
    budget?: number;
    style?: 'xml' | 'markdown' | 'json';
  } => ContextOutput;

  // Get project structure
  'ivo_tree': {
    depth?: number;
    includeTokenCounts?: boolean;
  } => DirectoryTree;

  // Score file relevance
  'ivo_relevance': {
    task: string;
    files: string[];
  } => RelevanceScore[];

  // Manage templates
  'ivo_template_save': { name: string; files: string[] } => void;
  'ivo_template_load': { name: string } => Template;
  'ivo_template_list': {} => Template[];
}
```

---

## Stdin Pipeline Integration

Following Unix philosophy, Ivo integrates seamlessly with standard CLI tools:

### File Selection Pipelines

```bash
# Find TypeScript files modified today
find src -name "*.ts" -mtime 0 | ivo context --stdin "Review today's changes"

# ripgrep for files containing pattern
rg -l "async.*await" src/ | ivo context --stdin "Async patterns review"

# git ls-files with filters
git ls-files "*.ts" | grep -v test | ivo context --stdin "Production code only"

# Complex pipeline
fd -e ts -e tsx src/ \
  | rg -l "useState|useEffect" \
  | head -20 \
  | ivo context --stdin "React hooks analysis"
```

### Integration with Other Tools

```bash
# Combine with code2prompt
code2prompt --include "src/**/*.ts" --tokens | ivo enhance --task "Add context"

# Chain with repomix
repomix --compress | ivo score --task "Security review" | karl run

# IDE integration via pipe
echo "$SELECTED_FILES" | ivo context --stdin "Explain selection"
```

---

## Token Encoding

Ivo supports multiple tokenizer encodings to match different LLM families:

| Encoding | Models | Notes |
|----------|--------|-------|
| `o200k_base` | GPT-4o, GPT-4o-mini | Default, most common |
| `cl100k_base` | GPT-4, GPT-3.5-turbo | OpenAI legacy |
| `claude` | Claude 3.x family | Anthropic models |
| `llama` | Llama 3.x, Mistral | Open source models |

```bash
# Specify encoding
ivo context --encoding claude "For Claude analysis"

# Auto-detect from Karl's model config
ivo context --auto-encoding "Uses current model"
```

---

## Security Scanning

Ivo integrates secret detection to prevent accidental exposure:

### Secretlint Integration

```typescript
// Detected secret types
const secretPatterns = [
  'aws-access-key-id',
  'aws-secret-access-key',
  'github-token',
  'private-key',
  'api-key',
  'password-assignment',
  'connection-string',
  'jwt-token',
];
```

### Behavior

```bash
ivo context "Deploy script"

# Warning output:
# ⚠️  Potential secrets detected:
#    - src/config/aws.ts:12 (aws-access-key-id)
#    - .env.local:3 (api-key)
#
# These files have been excluded. Use --include-sensitive to override.
```

### Configuration

```typescript
security: {
  enableSecretScan: true,
  scanMode: 'warn',  // 'warn' | 'exclude' | 'error'
  customPatterns: [
    /INTERNAL_API_KEY\s*=\s*['"][^'"]+['"]/,
  ],
}
```

---

## Daemon Integration (`ivod`)

Ivo can run as a daemon alongside `karld` for persistent context awareness:

```bash
# Start Ivo daemon
ivod start

# Daemon maintains:
# - Hot file tree cache
# - Relevance score cache
# - Merkle tree for change detection
# - Pre-computed codemaps

# Query warm context (instant)
ivo context --daemon "Quick query"  # ~20ms vs ~2s cold
```

### Socket API

```typescript
// Unix socket: ~/.karl/ivo.sock
interface IvoDaemonAPI {
  // Get context (uses cache)
  context(task: string, opts: ContextOpts): Promise<Context>;

  // Invalidate cache for files
  invalidate(patterns: string[]): Promise<void>;

  // Force full refresh
  refresh(): Promise<void>;

  // Get daemon stats
  stats(): Promise<DaemonStats>;
}
```

---

## Metrics and Analytics

### Context Quality Metrics

```sql
-- Track context effectiveness
CREATE TABLE context_sessions (
    id TEXT PRIMARY KEY,
    task_hash TEXT,
    timestamp TEXT,

    -- Input metrics
    files_considered INTEGER,
    files_included INTEGER,
    tokens_budget INTEGER,
    tokens_used INTEGER,

    -- Compression metrics
    compression_ratio REAL,
    codemaps_generated INTEGER,

    -- Quality signals (post-task)
    task_completed BOOLEAN,
    follow_up_needed BOOLEAN,
    files_missed TEXT,  -- Files that should have been included

    -- Cost
    estimated_cost REAL,
    model_used TEXT
);

-- File-level learning
CREATE TABLE file_relevance_history (
    file_path TEXT,
    task_type TEXT,
    predicted_relevance REAL,
    actual_usefulness REAL,  -- User feedback or completion signal
    timestamp TEXT
);
```

### Learning from Outcomes

```typescript
// After task completion, Ivo learns
interface TaskOutcome {
  contextUsed: string[];
  filesReferenced: string[];  // Which files Karl actually used
  taskSuccess: boolean;
  userFeedback?: 'good' | 'missing_context' | 'too_much';
}

// Ivo adjusts future relevance predictions
function updateRelevanceModel(outcome: TaskOutcome): void {
  // Files referenced but not included = boost relevance
  // Files included but not referenced = reduce relevance
  // User feedback = strong signal for adjustment
}
```

---

## Comparison with Similar Tools

| Feature | Ivo | Repomix | code2prompt |
|---------|-----|---------|-------------|
| AI-powered relevance | ✅ | ❌ | ❌ |
| Interactive TUI | ✅ | ❌ | ✅ |
| Tree-sitter compression | ✅ | ✅ | ❌ |
| Live token budget | ✅ | ❌ | ✅ |
| Daemon mode | ✅ | ❌ | ❌ |
| Merkle tree caching | ✅ | ❌ | ❌ |
| Learning from usage | ✅ | ❌ | ❌ |
| MCP server | ✅ | ✅ | ✅ |
| Git integration | ✅ | ✅ | ✅ |
| Secret scanning | ✅ | ✅ | ❌ |
| Karl integration | ✅ Native | ❌ | ❌ |

**Key differentiator**: Ivo is not just a context packager—it's an intelligent context **curator** that learns, adapts, and integrates deeply with Karl's execution model.

---

## Philosophy

**Ivo embodies the principle: "The best context is invisible."**

Users shouldn't think about context management. Ivo handles it silently, intelligently, and efficiently. When users want control, Ivo provides transparency without complexity.

Karl serves. Ivo sees. Together, they ace it.

---

## References & Inspiration

- [Repomix](https://repomix.com/) - AI-friendly repository packing
- [code2prompt](https://github.com/mufeedvh/code2prompt) - Context engineering with TUI
- [gpt-repository-loader](https://github.com/mpoon/gpt-repository-loader) - Early repo-to-prompt tool
- [Gitingest](https://gitingest.com/) - Browser-based repo ingestion
- [Tree-sitter](https://tree-sitter.github.io/) - Parsing for code intelligence
- [Secretlint](https://github.com/secretlint/secretlint) - Secret detection
