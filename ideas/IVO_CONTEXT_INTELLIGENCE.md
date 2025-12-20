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

## Philosophy

**Ivo embodies the principle: "The best context is invisible."**

Users shouldn't think about context management. Ivo handles it silently, intelligently, and efficiently. When users want control, Ivo provides transparency without complexity.

Karl serves. Ivo sees. Together, they ace it.
