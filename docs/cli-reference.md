# CLI Reference

```
karl run [flags] <task> [task...]
```

## Model Selection

| Flag | Description |
|------|-------------|
| `--fast`, `-f` | Smaller, faster model |
| `--smart`, `-s` | Larger, more capable model |
| `--model`, `-m` | Exact model ID |

## Model Commands

```bash
karl models fusion [alias] [--panel <csv>] [--judge <model>] [--required] [--default]
```

Creates an OpenRouter Fusion alias using the configured `openrouter` provider.
The generated model uses `openrouter/fusion`; panel/judge overrides and
`--required` are stored in the model's `request` passthrough.

## Route Broker

```bash
karl route plan [--json] [--route <id|name>] [--cwd <path>] <task>
karl route select [--json] [--route <id|name>] [--cwd <path>] <task>
```

`karl route` is the agent-facing two-step run broker. It interprets a task,
chooses a recommended route, lists alternatives, and materializes the selected
route as text or JSON. It does not silently replace `karl run`.

Useful for caller agents:

```bash
karl route plan --json "implement the verifier"
echo "compare these approaches" | karl route plan --json
karl route select --route panel --json "compare approaches"
karl route plan --json "read-only assess this repo; do not edit files"
```

Route names currently include `coder`, `readonly`, `panel`, `cheap`, `bodyplan`, and
`direct`. JSON output is stable enough for agents to inspect `kind`, `version`,
`recommended`, `alternatives`, `tools`, `availability`, and `execution`.
Evidence audits and "do not edit" requests should route to `readonly`, which
advertises `tools.mode: "read-only"` and omits write/edit tools.

## Output Control

| Flag | Description |
|------|-------------|
| `--quiet`, `-q` | Results only |
| `--verbose`, `-v` | Full traces |
| `--json`, `-j` | JSON output |
| `--stats` | Token usage and cost |

## Execution

| Flag | Description |
|------|-------------|
| `--max-concurrent` | Worker pool size (default: 3) |
| `--timeout` | Per-task timeout |
| `--skill` | Load a skill |
| `--no-tools` | Disable tool use |

## Input

| Flag | Description |
|------|-------------|
| `-` | Read from stdin |
| `--tasks-file` | One task per line |

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

## Run History and Events

Karl starts a durable SQLite history row before model/tool execution and appends
bounded run events as attempts, tools, diffs, retries, and completion occur.
This allows an interrupted run to retain its last durable evidence.

```bash
karl history
karl history <run-id>
karl history <run-id> --events
karl history <run-id> --events --full
karl history <run-id> --events --json
```

The JSON detail response uses `schemaVersion: 2` and contains both the
compatibility `run` record and ordered `events`. Runs left open by a process that
is no longer alive are reconciled to terminal reason `process_lost`; existing
events are preserved. Other terminal reasons include `succeeded`, `failed`,
`timed_out`, `stalled`, and `canceled`.

`.karl/status.json` is an ephemeral, overwrite-in-place progress snapshot for
operators. The SQLite run events under `~/.config/karl/history/history.db` are
the durable diagnostic record.

Event payloads redact recognized secret-bearing keys and environment maps and
cap nested strings and collections. `--full` expands only the stored, already
bounded/redacted payload. It cannot recover data discarded by redaction or
truncation.

## Power User Patterns

### Shell aliases

```bash
alias k='karl run'
alias kq='karl run --quiet'
alias ks='karl run --smart'
```

### Delegation from coding agents

```bash
# While Claude Code handles the main feature...
karl run "update the changelog"
karl run "check for flaky tests"
karl run "summarize open issues"
```

### CI/CD

```bash
karl run --json --quiet "analyze diff for security" > report.json
```

### Batch processing

```bash
karl run --tasks-file review-checklist.txt --max-concurrent 5
```
