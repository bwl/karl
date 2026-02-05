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
