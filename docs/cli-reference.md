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

## Explicit Model Comparisons

```bash
karl compare --models fast,smart [--context <manifest-id>] \
  [--judge <model>] [--timeout 30s] [--max-concurrent 2] [--json] \
  "review this design"
```

Comparison is opt-in, no-tools, and bounded to at most eight concurrent
candidates. Karl resolves every model alias, provider credential, and optional
context manifest before it creates the parent journal row. Unknown/duplicate
models, missing auth, invalid concurrency, legacy context without a manifest,
or any request for tools fail atomically before inference.

Candidates receive the same normalized task, system policy, context content,
and input/context hashes. Each candidate has a child receipt linked to the
parent comparison; one failure does not discard successful evidence, and human
and versioned JSON output preserve the requested model order. Reports include
duration, tokens/cost when providers return them, errors, and receipt IDs.

`--judge` adds a separate no-tools synthesis run after the candidates. Its
rubric, input hash, model, and receipt are explicit, and it never changes Karl's
configuration. Neither base output nor judge synthesis is a global winner or
capability ranking: it describes one prompt/context instance.

## Route Broker

```bash
karl route plan [--json] [--route <id|name>] [--cwd <path>] <task>
karl route select [--json] [--route <id|name>] [--cwd <path>] <task>
karl route architect [--json] [--verify <command>] [--cwd <path>] <task>
karl route execute --recipe evidence-led-patch [--yes] [--json] [--verify <command>] [--cwd <path>] <task>
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

### Evidence-led patch recipe

`route architect` compiles a versioned `karl.runArchitecture` without creating
a worktree or starting a model. Karl currently supports exactly one executable
recipe, `evidence-led-patch`, with these ordered phases:

```text
evidence -> scope_gate -> patch -> verify -> handoff
```

The evidence phase reads Git HEAD, branch, and status. Execution then requires
interactive approval or an explicit `--yes`; non-interactive callers cannot
mutate without that flag. After approval, Karl delegates through the existing
`magic --worktree --require-clean` path. The patch and declared checks run in
the same detached worktree, which is retained whether the run succeeds or
fails. The source worktree is compared with its pre-run evidence at handoff.

Verification defaults to `git diff --check`. Repeat `--verify` to declare the
project checks the handoff must pass:

```bash
karl route architect --json --verify "bun run check" "implement the verifier"
karl route execute --recipe evidence-led-patch --yes \
  --verify "bun run check" --verify "bun test" \
  "implement the verifier"
```

The handoff reports the retained path, changed files, command results,
unresolved failures, and residual risk. Karl does not commit, merge, push, or
delete the worktree. Each phase is also appended to the durable run journal;
the delegated `magic` run is linked to the parent architecture run.

## Output Control

| Flag | Description |
|------|-------------|
| `--quiet`, `-q` | Results only |
| `--verbose`, `-v` | Bounded command and result summaries |
| `--trace` | Bounded redacted trace guidance and receipt details |
| `--json`, `-j` | JSON output |
| `--stats` | Token usage and cost |

Output uses progressive disclosure. Summary mode is the default; `--verbose`
adds bounded command/result summaries; `--trace` points into the redacted event
journal. JSON remains machine-only on stdout. Model reasoning is not rendered
as terminal progress.

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
karl history <run-id> --verbose
karl history <run-id> --trace
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

Human-readable run detail leads with outcome, terminal reason, phase results,
changed-file count, validation, residual risk, receipt ID, and the exact
inspection command. Failures include the last relevant bounded tool/phase
summary. `--events` and `--trace` show the timeline; `--full` expands only the
already redacted, bounded journal payload.

## Context Manifests

```bash
karl context show <id> [--json] [--content] [--cwd <path>]
karl context diff <old> <new> [--json] [--cwd <path>]
```

Ivo remains the owner of pack content under `.ivo/contexts/`. When Karl's
orchestrator creates an Ivo XML pack, Karl atomically writes a provider-neutral
manifest under `.karl/contexts/` containing the source HEAD, pack hash, token
usage, and ordered selected-file paths, hashes, and optional reasons. It does
not move or rewrite Ivo files.

`context show` reports current, stale, and missing source files without dumping
the pack. Full XML appears only with explicit `--content`. `context diff`
reports deterministic path-sorted additions, removals, and content changes.
Existing Ivo packs without Karl manifests remain inspectable as `legacy`, with
the reduced metadata actually available.

Runs launched by the orchestrator journal the context manifest ID and hash in a
`context_linked` event. They do not copy the full pack or expanded system prompt
into the history record, so the manifest remains a stable reference even after
working files change.

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
