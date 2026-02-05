# Karl

**The fastest way to get LLM intelligence into your terminal.**

![Agent Skills](https://img.shields.io/badge/Agent%20Skills-Supported-brightgreen) ![Status](https://img.shields.io/badge/Status-Active-brightgreen)

```
$ karl run "how much energy from the sun reaches Earth each day?"

Breakdown:
  - Solar constant: ~1361 W/m² at the top of Earth's atmosphere.
  - Earth's cross-sectional area: πR² ≈ 1.27 × 10¹⁴ m².
  - Total power intercepted: ~1.74 × 10¹⁷ W.
  - Per day: 1.74 × 10¹⁷ W × 86,400 s ≈ 1.5 × 10²² J/day.

≈1.5 × 10²² joules per day reach Earth from the Sun.
```

---

## What is Karl?

Karl is a headless LLM assistant that lives in your terminal. It brings AI knowledge and action directly into your filesystem and standard I/O streams.

**Core philosophy:** *Serve-and-volley, not baseline rallies.*

- **One-shot** — Serve, ace, done. No follow-up, no continuation.
- **Fast** — Sub-second startup. No database. No sessions. Just ask.
- **Unix-native** — Plays nice with pipes, stdin, stdout, stderr
- **Parallel** — Send multiple tasks, volley them back efficiently
- **Minimal** — Four tools. No bloat. Extend via plugins.

---

## The Name

Named after **[Ivo Karlović](https://en.wikipedia.org/wiki/Ivo_Karlovi%C4%87)** — the 6'11" Croatian giant who holds the all-time ATP record for aces.

| Stat | Value |
|------|-------|
| Height | 6'11" (211 cm) |
| Career Aces | **13,728** (ATP record) |
| Aces in a Match | 78 (Davis Cup record) |
| Service Speed | 156 mph (251 km/h) |
| Career Span | 2000–2020 |

> *"I don't have a second serve. I have a first serve and a slower first serve."*
> — Ivo Karlović

Like Karlović's unreturnable serves, Karl delivers fast, one-shot responses. No rallies. No follow-ups. Just **aces**.

```
   ╭───────────────────────────────────╮
   │  KARL                             │
   │  🎾 13,728 aces and counting      │
   │  LLM volleys for your CLI         │
   ╰───────────────────────────────────╯
```

---

## Quick Examples

### Direct queries
```bash
karl "explain the CAP theorem in one paragraph"
karl "what's the mass of Jupiter in kilograms?"
```

### Working with code
```bash
karl "find all TODO comments in this project"
karl "review auth.go for security issues"
karl "commit the feature we just finished"
```

### Volley Mode (parallel)
```bash
karl "analyze auth.go" "analyze db.go" "analyze api.go"
karl "make 20 mobs for the NPC system. look at the 5 we built for inspo"
```

### Pipeline integration
```bash
cat error.log | karl "what went wrong here?"
karl "list all exported functions" | grep -i auth
git diff | karl "write a commit message for this"
```

---

## The Ace Model

*Serve and done.* Like Karlović on the court — no baseline rallies, no long exchanges. Just an unreturnable first serve.

Karl uses a **TUI while working, clean print on exit** pattern.

**During execution** — A live TUI shows progress:

```
┌─────────────────────────────────────┐
│  ◍ karl                           │
│                                     │
│  analyzing auth.go...               │
│  ├───▣ read   auth.go (245 lines)   │
│  ├───▣ bash   rg "TODO" (3 matches) │
│  └───◴ thinking...                  │
│                                     │
│  ░░░░░░░░░░░░░░░░░░░░░▒▒▒▒  67%     │
└─────────────────────────────────────┘
```

**On completion** — TUI clears, result prints to stdout:

```
$ karl "analyze auth.go for security issues"

Found 2 issues in auth.go:

1. [HIGH] Line 67: SQL injection via string concatenation
   → Use parameterized queries instead

2. [LOW] Line 112: Timing attack on password comparison
   → Use constant-time comparison

$ _
```

The work is done. The ace landed. Clean text you can scroll, copy, pipe, grep.

**Why this matters:**
- No TUI artifacts in your terminal history
- Output is just text — works with `| less`, `> file.txt`, etc.
- The live view is for *you* while waiting; the result is for *the record*

**Quiet mode** (`--quiet`) skips the TUI entirely — pure headless.

---

## Architecture

Inspired by [pi-mono](https://github.com/badlogic/pi-mono), Karl uses a layered monorepo:

```
karl/
├── packages/
│   ├── karl-providers/   # LLM provider abstraction
│   ├── karl-core/        # Agent loop, tool execution
│   ├── karl-tools/       # Built-in tool implementations
│   └── karl-cli/         # CLI interface, volley scheduler
└── plugins/                # Example custom tools
```

### Why This Structure?

1. **`karl-providers`** — Clean abstraction over OpenAI, Anthropic, OpenRouter, Ollama, vLLM. Swap providers without touching agent code.

2. **`karl-core`** — The agent loop: parse response → execute tools → feed result → repeat. No UI concerns.

3. **`karl-tools`** — Default tools as a separate package. Users can replace entirely or extend.

4. **`karl-cli`** — The user-facing binary. Volley scheduler, progress display, config loading.

**Lockstep versioning**: All packages share the same version. Bump together, publish together.

---

## Core Tools (4 Only)

Following pi's philosophy: minimal toolset, maximum capability.

| Tool | Purpose |
|------|---------|
| `bash` | Execute shell commands (subsumes grep, glob, find) |
| `read` | Read file contents (text + images) |
| `write` | Create or overwrite files |
| `edit` | Surgical find/replace modifications |

**Why not glob/grep tools?** They're just `bash` commands. The model knows `find`, `grep`, `rg`, `fd`. Don't duplicate what the shell already does well.

**Why separate read from bash cat?** Read handles:
- Binary detection
- Image encoding (for vision models)
- Large file truncation with offset/limit
- Consistent error messages

---

## Custom Tools (Plugins)

Extend Karl without forking. Drop a file in `~/.config/karl/tools/`:

```typescript
// ~/.config/karl/tools/jira.ts
import { defineTool } from 'karl-core';

export default defineTool({
  name: 'jira',
  description: 'Create or update Jira tickets',
  parameters: {
    type: 'object',
    properties: {
      action: { enum: ['create', 'update', 'comment'] },
      ticket: { type: 'string' },
      content: { type: 'string' }
    },
    required: ['action']
  },
  async execute({ action, ticket, content }) {
    // Your Jira API logic
    return { success: true, ticket: 'PROJ-123' };
  }
});
```

Tools are loaded at startup. No recompilation needed.

---

## Agent Skills Support 🎯

Karl fully supports the [Agent Skills](https://agentskills.io) open standard for extending AI capabilities with specialized knowledge and workflows.

### Using Skills

```bash
karl --skill security-review "analyze this codebase for vulnerabilities"
karl --skill code-review "review the changes in auth.go"
karl --skill documentation "create API docs for the user service"
```

### Managing Skills

```bash
# List available skills
karl skills list

# Show skill details
karl skills show security-review

# Create a new skill
karl skills create my-workflow --description "Custom analysis workflow"

# Validate a skill
karl skills validate ./path/to/skill
```

### Built-in Skills

- **security-review**: Comprehensive security analysis and vulnerability scanning
- **code-review**: Code quality assessment and best practices validation  
- **documentation**: Technical documentation creation (APIs, guides, READMEs)

### Skill Locations

- `~/.config/karl/skills/` - Global skills
- `./.karl/skills/` - Project-specific skills

Skills use the standard Agent Skills format with YAML frontmatter and are fully portable across Agent Skills-compatible tools. See [AGENT_SKILLS.md](packages/karl/AGENT_SKILLS.md) for complete documentation.

---

## Hooks

Run custom logic at key points:

| Hook | When |
|------|------|
| `pre-task` | Before each task starts |
| `post-task` | After each task completes |
| `pre-tool` | Before tool execution |
| `post-tool` | After tool execution |
| `on-error` | When a task fails |

```typescript
// ~/.config/karl/hooks/audit.ts
export default {
  'post-tool': async (event) => {
    if (event.tool === 'bash') {
      await appendToLog(`[${new Date()}] ${event.input.command}`);
    }
  }
};
```

Use cases:
- Audit logging for compliance
- Notifications (Slack, email) on completion
- Metrics/telemetry collection
- Custom retry logic

---

## Volley Mode (Parallel Execution)

Multiple balls in the air. The TUI shines here.

```bash
karl "analyze auth.go" "analyze db.go" "analyze api.go" "analyze main.go"
```

### The TUI During a Volley

```
┌──────────────────────────────────────────────────────────────┐
│  ◍ karl volley                            4 tasks │ ─────  │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  1 │ ◍ analyze auth.go                                       │
│    │   └── 2 issues found                          1.2s  ✓   │
│                                                              │
│  2 │ ◴ analyze db.go                                         │
│    │   ├───▣ read   db.go (892 lines)                        │
│    │   ├───▣ bash   rg "SELECT|INSERT" (12 matches)          │
│    │   └───◴ thinking...                                     │
│                                                              │
│  3 │ ◵ analyze api.go                                        │
│    │   ├───▣ read   api.go (445 lines)                       │
│    │   └───◴ thinking...                                     │
│                                                              │
│  4 │ ○ analyze main.go                              queued   │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│  ░░░░░░░░░░░░░░░░▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒  1/4 complete   25%   │
└──────────────────────────────────────────────────────────────┘
```

Each task row shows:
- **Status**: `○` queued → `◴◵◶◷` running → `◍` done → `✗` failed
- **Tool trace**: Live updates as tools execute
- **Timing**: Elapsed time, completion indicator

### The Print After

TUI clears. Results print in order:

```
$ karl "analyze auth.go" "analyze db.go" "analyze api.go" "analyze main.go"

━━━ 1/4: analyze auth.go ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Found 2 issues:

1. [HIGH] Line 67: SQL injection via string concatenation
2. [LOW] Line 112: Timing attack on password comparison

━━━ 2/4: analyze db.go ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Found 1 issue:

1. [MEDIUM] Line 234: Connection pool exhaustion possible under load

━━━ 3/4: analyze api.go ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

No issues found. Code follows security best practices.

━━━ 4/4: analyze main.go ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

No issues found.

━━━ Summary ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
4 tasks completed in 8.3s
3 issues found across 4 files
12.4k tokens ($0.037)

$ _
```

### Layout Modes

The TUI adapts to task count:

| Tasks | Layout |
|-------|--------|
| 1 | Single pane with full tool trace (Ace mode) |
| 2-6 | Stacked rows, each with inline trace |
| 7+ | Compact list, expand active task only |

### Scheduler Details

- **Worker pool**: `--max-concurrent` (default: 3)
- **Rate limiting**: Auto-handles 429 with exponential backoff
- **Ordering**: Results print in original order, not completion order
- **Failure isolation**: One task failing doesn't stop others

```bash
# Crank up concurrency for independent tasks
karl --max-concurrent 10 "task1" "task2" ... "task10"

# Conservative for rate-limited APIs
karl --max-concurrent 2 "task1" "task2" "task3"
```

---

## Context Loading

Automatic project context from:
- `CLAUDE.md`, `AGENTS.md`, `COPILOT.md`
- `.cursorrules`, `.github/copilot-instructions.md`
- `.karl/context.md` (project-specific)

Explicit context:
```bash
karl --context "You are a security expert" "review this"
karl --context-file system-prompt.txt "analyze the architecture"
```

**No session state.** Each invocation is fresh. For multi-turn work, use a full coding agent (pi, Claude Code) and delegate to Karl for side tasks.

---

## Command Line Interface

```
karl [flags] <task> [task...]
```

### Model Selection

| Flag | Description |
|------|-------------|
| `--fast`, `-f` | Smaller, faster model |
| `--smart`, `-s` | Larger, more capable model |
| `--model`, `-m` | Exact model ID |

### Output Control

| Flag | Description |
|------|-------------|
| `--quiet`, `-q` | Results only |
| `--verbose`, `-v` | Full traces |
| `--json`, `-j` | JSON output |
| `--stats` | Token usage and cost |

### Execution

| Flag | Description |
|------|-------------|
| `--max-concurrent` | Worker pool size (default: 3) |
| `--timeout` | Per-task timeout |
| `--skill` | Load a skill |
| `--no-tools` | Disable tool use |

### Input

| Flag | Description |
|------|-------------|
| `-` | Read from stdin |
| `--tasks-file` | One task per line |

---

## Configuration

### File Locations

```
~/.config/karl/
├── karl.json      # Main config
├── tools/           # Custom tools
├── skills/          # Skill definitions
└── hooks/           # Hook scripts
```

Project-level `.karl.json` overrides global config.

### Config Schema

```json
{
  "defaultModel": "fast",
  "models": {
    "fast": {
      "provider": "openrouter",
      "model": "anthropic/claude-sonnet-4-20250514"
    },
    "smart": {
      "provider": "anthropic",
      "model": "claude-sonnet-4-20250514"
    }
  },
  "providers": {
    "openrouter": {
      "type": "openai",
      "baseUrl": "https://openrouter.ai/api/v1",
      "apiKey": "${OPENROUTER_API_KEY}"
    },
    "anthropic": {
      "type": "anthropic",
      "apiKey": "${ANTHROPIC_API_KEY}"
    }
  },
  "tools": {
    "enabled": ["bash", "read", "write", "edit"],
    "custom": ["~/.config/karl/tools/*.ts"]
  },
  "volley": {
    "maxConcurrent": 3,
    "retryAttempts": 3,
    "retryBackoff": "exponential"
  }
}
```

---

## Output Formats

### Text (default)

```
The answer is 42.
```

### JSON (`--json`)

```json
{
  "results": [{
    "task": "...",
    "status": "success",
    "result": "...",
    "tokens": { "input": 500, "output": 200 },
    "duration_ms": 2450,
    "tools_used": ["read", "bash"]
  }],
  "summary": {
    "total": 1,
    "succeeded": 1,
    "failed": 0,
    "tokens": 700,
    "cost": 0.0021
  }
}
```

---

## Visual Language

| Symbol | Meaning |
|--------|---------|
| `◍` | Task complete |
| `○` | Task queued |
| `◴◵◶◷` | In progress (spinner) |
| `✗` | Task failed |
| `▣` | Tool succeeded |
| `☒` | Tool failed |

Tool traces (with `--verbose`):

```
◍ Task 1/2: fix the bug in parser.go
├───▣ read     parser.go (245 lines)
├───▣ bash     rg "parseToken" (3 matches)
├───▣ edit     parser.go:67-89
╰───▣ bash     go test ./... (passed)

Fixed the off-by-one error in parseToken()...
```

---

## Error Handling

### Auto-retry

- Rate limits (429)
- Timeouts
- Network errors

Backoff: 1s → 2s → 4s → 8s (max 60s)

### Immediate fail

- Auth errors (401, 403)
- Bad request (400)
- Model not found

### Exit codes

| Code | Meaning |
|------|---------|
| `0` | All tasks succeeded |
| `1` | At least one failed |

---

## Power User Patterns

### Shell alias
```bash
alias c='karl'
alias cq='karl --quiet'
alias cs='karl --smart'
```

### Delegation from coding agents
```bash
# While Claude Code handles the main feature...
karl "update the changelog"
karl "check for flaky tests"
karl "summarize open issues"
```

### CI/CD
```bash
karl --json --quiet "analyze diff for security" > report.json
```

### Batch processing
```bash
karl --tasks-file review-checklist.txt --max-concurrent 5
```

---

## Design Principles

1. **Speed over features** — Fast startup, minimal deps
2. **Unix philosophy** — One job, compose with pipes
3. **Minimal tools** — 4 core, extend via plugins
4. **No state** — Each run is fresh
5. **Transparent** — Show tools, tokens, cost
6. **Extensible** — Skills, hooks, custom tools

---

## Implementation Stack

Following pi's lead:

- **Language**: TypeScript (Bun runtime for speed)
- **Build**: esbuild for fast bundling
- **Binary**: Bun's single-file compiler
- **Testing**: Vitest, skip LLM tests in CI
- **TUI**: Differential rendering (like pi-tui) for flicker-free updates

### The TUI Challenge

The ephemeral TUI needs to:
1. Render in an alternate screen buffer (so it can vanish cleanly)
2. Use differential rendering (only redraw what changed — no flicker)
3. Exit cleanly and print result to main buffer

Could use pi-tui directly, or build a minimal version for Karl's specific needs (progress + tool tree + spinner).

---

## What Karl Is Not

- **Not a coding agent** — No sessions, no memory, no multi-turn
- **Not a chat interface** — No REPL, no conversation
- **Not a framework** — It's a tool, not a library

For multi-turn work: use pi, Claude Code, or aider. Delegate parallel/batch tasks to Karl.

---

## Log

### 2024-12-18
- Initial spec created
- Enhanced with pi-mono architecture patterns:
  - Reduced to 4 core tools (bash, read, write, edit)
  - Added custom tools/plugins system
  - Added skills (loadable instruction sets)
  - Added hooks for automation
  - Layered monorepo structure
  - Lockstep versioning
- Clarified "Ace Model" — TUI while working, clean print on exit
  - Like serving an ace: set up, serve, done
  - No expectation of follow-up or continuation
  - Ephemeral TUI for progress, permanent text for result
- Expanded Volley Mode with full TUI mockups
  - Multi-task layout showing parallel progress
  - Per-task tool traces
  - Adaptive layout (1 task vs 2-6 vs 7+)
  - Clean ordered print on completion with summary
- Added stack.md: how to build on pi-mono packages
  - pi-ai for provider abstraction
  - pi-agent for tool loop
  - pi-tui for flicker-free ephemeral UI
  - Custom: volley scheduler, ace UX, skills/hooks
