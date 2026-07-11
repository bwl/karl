# Plan 006: Add explicit, reproducible model comparisons

> **Executor instructions**: Keep comparison opt-in and evidence-oriented. Do not add automatic model learning or a global capability database. Run all checks and update `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 1ab5a69..HEAD -- packages/karl/src/run-broker.ts packages/karl/src/runner.ts packages/karl/src/cli.ts packages/karl/src/commands packages/karl/src/history.ts packages/karl/scripts/test-all.ts docs`

## Status

- **Priority**: P3
- **Effort**: L
- **Risk**: MED
- **Depends on**: `plans/002-add-crash-safe-run-journal.md`, `plans/004-make-context-packs-inspectable.md`
- **Category**: direction
- **Planned at**: commit `1ab5a69`, 2026-07-11

## Why this matters

Karl already has multiple providers/models and a `panel` route, while the idea archive proposes consensus, tournaments, and cost-quality experiments. The useful first slice is a reproducible comparison with identical task/context and separate receipts—not opaque automatic routing, gamification, or crowdsourced rankings.

## Current state

- `packages/karl/src/run-broker.ts` defines `panel` and `bodyplan` routes alongside direct/coder routes.
- `packages/karl/src/runner.ts:91-263` runs one task/model and reports tokens, duration, tools, and result.
- `packages/karl/src/history.ts:14-75` records model/provider/tokens/diffs per run.
- Plan 002 supplies durable events; Plan 004 supplies stable context references.

## Commands you will need

`bun run test`, `bun run check`, `bun run --cwd packages/karl test-skills`, and `git diff --check` must exit 0.

## Scope

**In scope**: `packages/karl/src/commands/compare.ts` (create), `packages/karl/src/comparison.ts` (create), `packages/karl/src/cli.ts`, `packages/karl/src/commands/completions.ts`, `packages/karl/src/runner.ts`, `packages/karl/src/history.ts`, `packages/karl/src/types.ts`, `packages/karl/scripts/test-all.ts`, `docs/cli-reference.md`, `docs/configuration.md`.

**Out of scope**: automatic default-model changes, subjective winner selection by Karl, public leaderboards, model pricing sync, self-play, skill evolution, write-enabled comparison runs, more than bounded local concurrency.

## Git workflow

Branch `advisor/006-model-comparisons`; imperative commits; no push/PR.

## Steps

### Step 1: Define a versioned comparison specification

Define task, ordered model aliases, optional context-pack ID, timeout, max concurrency, and output mode. Default comparisons are no-tools; any tool-enabled comparison must be rejected in this plan. Resolve all models/config before starting and fail preflight atomically if any are unavailable.

**Verify**: tests cover valid spec, duplicate/unknown models, missing auth, invalid concurrency, and attempted tools.

### Step 2: Execute bounded parallel runs

Add `karl compare --models a,b [--context <id>] <task>`. Run the same normalized prompt/system policy/context hash for each model with bounded concurrency. One model failure must not erase successful results. Journal a parent comparison and child run IDs.

**Verify**: fake-provider integration test proves identical inputs, concurrency cap, stable model ordering, isolated failures, and linked receipts.

### Step 3: Report evidence without declaring a winner

Human output shows each model's result, duration, tokens/cost when available, error, and receipt ID. JSON is versioned and contains context hash plus normalized input hash. Add optional `--judge <model>` only as a separately recorded synthesis run that exposes its rubric and never changes configuration.

**Verify**: output tests cover partial failure, absent cost, stable JSON, and judge provenance.

### Step 4: Document and gate

Document that comparison measures one prompt/context instance and is not a capability ranking.

**Verify**: `bun run check && bun run --cwd packages/karl test-skills && git diff --check` → exit 0.

## Test plan

Use fake providers only. Cover preflight atomicity, identical inputs, ordering, concurrency, timeout, partial failure, parent/child history, context hashes, JSON version, and judge provenance.

## Done criteria

- [ ] Comparisons are explicit, no-tools, bounded, and reproducible.
- [ ] Every child has its own durable receipt linked to a parent comparison.
- [ ] Output reports evidence without silently choosing or configuring a winner.
- [ ] No marketplace, rankings, learning, or remote sync is introduced.
- [ ] Full gates pass; scope is clean.

## STOP conditions

- Identical effective prompt/context cannot be guaranteed across provider adapters.
- The feature requires write tools or shared mutable workspace state.
- Plan 002 or 004 identifiers are unavailable.
- A pricing database becomes required for the base feature.

## Maintenance notes

Comparisons are experiments, not truth. Preserve input/context hashes and raw receipts so later interpretation remains auditable when model behavior changes.
