# Plan 003: Execute one validated evidence-led run recipe

> **Executor instructions**: Implement only the vertical slice below. Do not generalize it into a workflow engine. Run every verification and update `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 1ab5a69..HEAD -- packages/karl/src/run-broker.ts packages/karl/src/commands/route.ts packages/karl/src/commands/magic.ts packages/karl/src/runner.ts packages/karl/scripts/test-all.ts docs/run-architecture-roadmap.md`

## Status

- **State**: DONE
- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: `plans/001-establish-work-governance.md`, `plans/002-add-crash-safe-run-journal.md`
- **Category**: direction
- **Planned at**: commit `1ab5a69`, 2026-07-11

## Why this matters

`karl route` currently recommends and materializes routes but explicitly does not execute them. Karl's differentiating claim—decide how work should run, enforce boundaries, and leave a receipt—needs one end-to-end proof before any general DAG design. The safest proof is an evidence-led patch performed in an isolated worktree with a human gate and explicit verification.

## Current state

- `packages/karl/src/commands/route.ts:63-74` says the broker does not replace `karl run`.
- `packages/karl/src/run-broker.ts:1-76` defines versioned route plans with tools, worktree, availability, and execution metadata.
- `packages/karl/src/commands/magic.ts:262-288` creates detached worktrees at `HEAD` and preserves them.
- `packages/karl/src/commands/magic.ts:365-381` prints a receipt while keeping human integration responsibility.
- `docs/run-architecture-roadmap.md:178-219` calls for deterministic compilation and small process recipes.
- Plan 002 supplies durable attempts and events; do not build a second receipt store.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Tests | `bun run test` | all pass |
| Full gate | `bun run check` | exit 0 |
| Skills | `bun run --cwd packages/karl test-skills` | exit 0 |
| Whitespace | `git diff --check` | no output |

## Scope

**In scope**: `packages/karl/src/run-broker.ts`, `packages/karl/src/run-architecture.ts` (create), `packages/karl/src/commands/route.ts`, `packages/karl/src/commands/magic.ts`, `packages/karl/src/types.ts`, `packages/karl/scripts/test-all.ts`, `docs/cli-reference.md`, `docs/run-architecture-roadmap.md`.

**Out of scope**: arbitrary DAGs, parallel execution, daemon scheduling, automatic commits/merges/pushes, remote tracker mutation, deleting worktrees, LLM-generated policy, more than one executable recipe.

## Git workflow

- Branch: `advisor/003-evidence-led-recipe`
- Use small imperative commits; do not push or open a PR.

## Steps

### Step 1: Define a typed architecture contract and compiler

Add a versioned `RunArchitecture` for exactly `evidence-led-patch` with ordered phases: `evidence`, `scope_gate`, `patch`, `verify`, `handoff`. Compile it from an existing route plan plus capability inputs. Validation must reject cycles/unknown phases, read-only phases with mutation tools, patch phases without worktrees, missing human gate, and missing verification.

**Verify**: table-driven tests cover one valid architecture and every rejection; `bun run test` passes.

### Step 2: Add explicit planning and execution commands

Support `karl route architect [--json] <task>` and `karl route execute --recipe evidence-led-patch <task>`. Planning is side-effect free. Execution must print the compiled plan and require an explicit confirmation flag or interactive confirmation before mutation.

**Verify**: CLI JSON test asserts `kind`, version, phase order, tools, worktree policy, and verification; execution without confirmation exits non-zero before worktree creation.

### Step 3: Execute through existing isolation

Reuse `magic --worktree --require-clean` rather than copying worktree logic. Evidence runs read-only; patch runs only inside the detached worktree; verification runs inside the same worktree. Preserve the worktree for review on every outcome. Record source HEAD, worktree path, phase transitions, commands, terminal reason, and residual risk through Plan 002's journal.

**Verify**: an integration fixture uses a fake agent executable and temporary Git repo; it proves source tree unchanged, worktree changed, phases ordered, and failure retains the worktree.

### Step 4: Implement the human gate and handoff

The gate must show evidence summary, planned mutation route, worktree, and checks. Non-interactive mode requires an explicit approval flag. Handoff reports changed files, verification, unresolved failures, worktree path, and a clear statement that no merge/commit/push occurred unless the operator separately requested it.

**Verify**: tests cover rejected gate, accepted gate, verification failure, and successful human-review handoff.

### Step 5: Document and gate

Mark the roadmap slice implemented without claiming general architecture support.

**Verify**: `bun run check && bun run --cwd packages/karl test-skills && git diff --check` → exit 0.

## Test plan

Use temporary repos and fake runners; never call a real model. Cover compiler invariants, dry plan, non-interactive approval, source isolation, retained workspace, phase journal, failed verification, and handoff receipt.

## Done criteria

- [x] One recipe plans and executes end to end.
- [x] No mutation occurs before a human/explicit gate.
- [x] Source worktree remains unchanged; scratch worktree is retained.
- [x] Every phase is journaled and verification determines handoff status.
- [x] No general DAG or automatic integration behavior was added.
- [x] Full gates pass; scope is clean.

## STOP conditions

- Existing `magic` worktree behavior cannot be reused without destructive cleanup.
- The implementation needs automatic commit, merge, push, or source-tree mutation.
- A second workflow language becomes necessary.
- Plan 002 event contracts are unavailable or materially incompatible.

## Maintenance notes

Treat this as a tracer bullet. Additional recipes must reuse the same compiler and phase journal, and each must justify why a direct run is insufficient.
