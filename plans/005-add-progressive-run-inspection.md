# Plan 005: Add progressive-disclosure run inspection

> **Executor instructions**: Build on the journal; do not introduce a full-screen TUI or new UI dependency. Run each verification and update `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 1ab5a69..HEAD -- packages/karl/src/commands/agent-repl.ts packages/karl/src/orchestrator.ts packages/karl/src/commands/history.ts packages/karl/src/status.ts packages/karl/src/utils/visuals.ts packages/karl/scripts/test-all.ts`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: `plans/002-add-crash-safe-run-journal.md`
- **Category**: direction
- **Planned at**: commit `1ab5a69`, 2026-07-11

## Why this matters

Long runs mix final answers, tool progress, and raw delegated output. The split-pane idea identifies the right information problem, but a full TUI would add terminal state and rendering risk. A concise live surface backed by durable event inspection provides most of the value while preserving pipes and plain terminals.

## Current state

- `packages/karl/src/commands/agent-repl.ts:265-408` renders live orchestrator events and buffers all nested Karl output before printing it.
- `packages/karl/src/orchestrator.ts:1218-1239` already emits summarized local tool start/end events.
- `packages/karl/src/status.ts:9-23` exposes a small mutable status snapshot.
- `packages/karl/src/commands/history.ts:44-116` prints run summaries and optional aggregate details.
- Plan 002 adds the authoritative event timeline; this plan must not invent another log.

## Commands you will need

`bun run test`, `bun run check`, `bun run --cwd packages/karl test-skills`, and `git diff --check` must exit 0.

## Scope

**In scope**: `packages/karl/src/commands/agent-repl.ts`, `packages/karl/src/orchestrator.ts`, `packages/karl/src/commands/history.ts`, `packages/karl/src/status.ts`, `packages/karl/src/print.ts`, `packages/karl/src/utils/visuals.ts`, `packages/karl/scripts/test-all.ts`, `docs/tui.md`, `docs/cli-reference.md`.

**Out of scope**: Ink/React, dual panes, mouse input, raw hidden reasoning display, web UI, replay with original timing, changing JSON stdout contracts.

## Git workflow

Branch `advisor/005-run-inspection`; imperative commits; no push/PR.

## Steps

### Step 1: Define output modes

Specify `summary` (default), `verbose`, and `trace`. Summary shows phase/tool outcome, duration, changed-file count, validation, and receipt ID; verbose adds bounded command/result summaries; trace points to or prints the redacted journal events. JSON mode remains machine-only and stdout-clean. Respect `NO_COLOR`, non-TTY output, and current `--plain` behavior.

**Verify**: formatter unit tests use fixed events and assert deterministic text for TTY/plain/JSON modes.

### Step 2: Render live events without buffering walls of output

Replace unconditional nested-output replay with bounded summaries in default mode. Preserve full redacted details in Plan 002's journal and print `Inspect: karl history <id> --events`. Errors automatically include the last relevant tool failure summary.

**Verify**: a fixture producing large output stays below the configured display cap while the journal retains a marked truncated event.

### Step 3: Improve inspection commands

Make `karl history <id>` lead with outcome, terminal reason, phases, files, validation, and residual risk. `--events` shows timeline; `--full` expands redacted bounded detail. Never label streamed model text as private chain-of-thought.

**Verify**: golden string tests cover success, tool failure, timeout/process loss, narrow terminal, no-color, and JSON.

### Step 4: Document and gate

Update docs to explain modes and why a full TUI is deferred.

**Verify**: `bun run check && bun run --cwd packages/karl test-skills && git diff --check` → exit 0.

## Test plan

Use pure formatter fixtures plus one CLI smoke test. Cover caps, truncation signals, stderr/stdout separation, `NO_COLOR`, non-TTY, failure context, and receipt command.

## Done criteria

- [ ] Default output remains concise during long runs.
- [ ] Full redacted evidence remains inspectable by run ID.
- [ ] Pipes/JSON contain no spinner or status decoration.
- [ ] No full-screen UI dependency is added.
- [ ] Full gates pass; scope is clean.

## STOP conditions

- Plan 002 does not expose ordered redacted events.
- Required UX needs raw unredacted tool output or hidden reasoning.
- A change would break existing JSON output or piping semantics.

## Maintenance notes

The journal is the model; terminal output is a projection. Keep rendering pure and terminal capability-aware so a future optional TUI can consume the same events.
