# Volley Mode (Parallel Execution)

Multiple balls in the air. The TUI shines here.

```bash
karl run "analyze auth.go" "analyze db.go" "analyze api.go" "analyze main.go"
```

## The TUI During a Volley

```
┌──────────────────────────────────────────────────────────────┐
│  ◍ karl volley                            4 tasks │ ─────    │
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

## The Print After

TUI clears. Results print in order:

```
$ karl run "analyze auth.go" "analyze db.go" "analyze api.go" "analyze main.go"

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

## Layout Modes

The TUI adapts to task count:

| Tasks | Layout |
|-------|--------|
| 1 | Single pane with full tool trace (Ace mode) |
| 2-6 | Stacked rows, each with inline trace |
| 7+ | Compact list, expand active task only |

## Scheduler Details

- **Worker pool**: `--max-concurrent` (default: 3)
- **Rate limiting**: Auto-handles 429 with exponential backoff
- **Ordering**: Results print in original order, not completion order
- **Failure isolation**: One task failing doesn't stop others

```bash
# Crank up concurrency for independent tasks
karl run --max-concurrent 10 "task1" "task2" ... "task10"

# Conservative for rate-limited APIs
karl run --max-concurrent 2 "task1" "task2" "task3"
```
