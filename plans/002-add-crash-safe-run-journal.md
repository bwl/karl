# Plan 002: Add a crash-safe, inspectable run journal

> **Executor instructions**: Execute each step and verification in order. Preserve backward compatibility with existing history rows. Stop rather than weakening redaction or durability. Update `plans/README.md` when complete.
>
> **Drift check (run first)**: `git diff --stat 1ab5a69..HEAD -- packages/karl/src/history.ts packages/karl/src/cli.ts packages/karl/src/runner.ts packages/karl/src/agent-loop.ts packages/karl/src/tools.ts packages/karl/src/commands/history.ts packages/karl/scripts/test-all.ts`

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: `plans/001-establish-work-governance.md`
- **Category**: direction
- **Planned at**: commit `1ab5a69`, 2026-07-11

## Why this matters

Karl currently inserts the durable history row only after a run finishes. An OOM can therefore leave only aggregate tool names and no exact event sequence, even though the agent loop already emits tool-call arguments and results. The recovery on 2026-07-11 succeeded only because earlier completed runs had recorded file diffs. A journal written incrementally must make failed runs explainable without turning secrets or unlimited command output into history.

## Current state

- `packages/karl/src/agent-loop.ts:75-76,368-384` emits `tool_execution_start` with arguments and `tool_execution_end` with result/error state.
- `packages/karl/src/runner.ts:91-120` reduces tool events to a `Set<string>` and forwards scheduler events; it does not persist agent-loop tool arguments.
- `packages/karl/src/history.ts:157-186` stores one final `runs` row with JSON `tools_used` and `diffs`; `PRAGMA user_version` is 1.
- `packages/karl/src/cli.ts:1091-1194` accumulates thinking/diffs in memory and calls `insertRun` at completion.
- `packages/karl/src/status.ts:122-132` overwrites best-effort status JSON and silently ignores write failures.
- `packages/karl/src/commands/history.ts:44-116` shows aggregate run data but no timeline.
- TypeScript uses ESM, explicit `.js` imports, two-space indentation, semicolons, and single quotes.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `bun run typecheck` | exit 0 |
| Tests | `bun run test` | all existing plus new tests pass |
| Full gate | `bun run check` | exit 0 |
| Diff | `git diff --check` | no output |

## Scope

**In scope**:
- `packages/karl/src/history.ts`
- `packages/karl/src/cli.ts`
- `packages/karl/src/runner.ts`
- `packages/karl/src/agent-loop.ts`
- `packages/karl/src/tools.ts`
- `packages/karl/src/types.ts`
- `packages/karl/src/commands/history.ts`
- `packages/karl/scripts/test-all.ts`
- `docs/cli-reference.md`
- `docs/configuration.md`

**Out of scope**:
- Automatic rollback or replaying shell commands
- Remote issue/PR writes
- Persisting raw API keys, environment values, system prompts, or unbounded outputs
- Replacing SQLite or changing the default history location
- Full orchestration state or daemon scheduling

## Git workflow

- Branch: `advisor/002-run-journal`
- Prefer commits `Add incremental run journal storage`, `Expose run event inspection`, and `Document journal privacy controls`.
- Do not push or open a PR without instruction.

## Steps

### Step 1: Define the journal domain and migration

Add a versioned `run_events` table keyed by `(run_id, sequence)` with timestamp, event type, attempt, tool call ID/name, redacted summary payload, success, and truncation metadata. Add `HistoryStore.startRun`, `appendRunEvent`, and `finishRun`; retain `insertRun` as a compatibility wrapper. Migrate schema idempotently from user version 1.

Use explicit terminal reasons: `succeeded`, `failed`, `timed_out`, `stalled`, `canceled`, and `process_lost`. Existing public `success|error` status may remain as a compatibility projection.

**Verify**: add a migration test that opens a v1 fixture, appends events, finishes the run, reopens it, and reads the same ordered timeline; `bun run test` → pass.

### Step 2: Add bounded redaction before persistence

Create one serializer used by every journal writer. It must redact case-insensitive secret-bearing keys (`apiKey`, `authorization`, `token`, `password`, `secret`, cookie values), omit `bash.env` values, cap strings/arrays/result text, and mark truncation. Preserve the shell command text because diagnosis requires it, but document that commands containing inline secrets are unsafe and apply conservative pattern redaction where practical.

Do not persist raw thinking by default in new events. Preserve existing history behavior for backward compatibility until a separate privacy migration is approved.

**Verify**: tests feed nested secret keys, environment maps, long output, and normal command arguments; serialized JSON contains no fixture secret and includes truncation metadata.

### Step 3: Start the run before launching tools

In `cli.ts`, create the history identity and `startRun` record before `StatusWriter`/runner execution. Finish the row in a `finally`-safe path for success, normal error, and timeout. If the process disappears, the next history open or `karl history` command must classify stale `running` rows as `process_lost` without erasing their events.

Journal retry scheduling and attempt boundaries as events.

**Verify**: an integration test starts a run record, appends one event, simulates reopening without finish, and observes `process_lost` plus the original event.

### Step 4: Wire tool lifecycle events incrementally

Forward `tool_execution_start/end` through `runner.ts` without collapsing arguments to names. Append start before execution and end immediately after result/error. Continue recording `ToolDiff` events, but reference their event sequence so recovery can order mutations relative to shell calls.

Journal writes must not crash the run when history is explicitly optional; they must emit an operator-visible warning once per run. Do not silently swallow repeated durability failure while claiming a receipt is complete.

**Verify**: a fake tool run produces ordered `run_started`, `tool_started`, `diff_recorded` where applicable, `tool_finished`, and `run_finished` events.

### Step 5: Add an inspection surface

Extend `karl history <id>` with `--events` and ensure `--json` returns a versioned object containing run plus ordered events. Default human output should show concise timestamps, attempt, tool, summary, success, and truncation; raw payload expansion requires `--full`.

**Verify**: CLI tests assert stable JSON version, ordering, redaction, and useful output for an interrupted run.

### Step 6: Document retention and privacy

Document what is persisted, default caps, redaction limits, how to disable history, and that inline secrets in prompts or shell commands remain the user's responsibility. Describe the difference between ephemeral `.karl/status.json` and durable SQLite events.

**Verify**: `rg -n "run events|redact|retention|inline secrets|process_lost" docs/cli-reference.md docs/configuration.md` → all concepts found.

### Step 7: Run the full gate

**Verify**: `bun run check && bun run --cwd packages/karl test-skills && git diff --check` → exit 0.

## Test plan

Model new tests on the History suite in `packages/karl/scripts/test-all.ts`. Cover v1 migration, ordered append, interruption recovery, each terminal reason mapping, nested redaction, output truncation, event inspection, JSON schema version, disabled history, and journal-write failure warning behavior.

## Done criteria

- [ ] A run row exists before the first tool executes.
- [ ] Tool start/end arguments and summaries survive simulated process loss.
- [ ] Secrets and environment values are redacted in tests.
- [ ] Existing v1 history databases open without data loss.
- [ ] `karl history <id> --events` works for completed and interrupted runs.
- [ ] Full gates pass and only in-scope files plus `plans/README.md` changed.

## STOP conditions

- Safe event persistence requires storing provider credentials or unredacted environment values.
- Bun SQLite cannot provide the needed migration/append guarantees under WAL.
- Existing history rows would need destructive migration.
- Wiring events requires changing provider protocol behavior rather than local event handling.

## Maintenance notes

The event journal becomes the foundation for receipts, UX, recovery, recipes, and comparisons. Keep event types append-only and versioned. Review every new payload field for privacy and size before persisting it.
