# Plan 004: Make context packs inspectable and reproducible

> **Executor instructions**: Preserve Ivo interoperability and stop on any storage-contract ambiguity. Run all verification commands and update `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 1ab5a69..HEAD -- packages/karl/src/context-store.ts packages/karl/src/orchestrator.ts packages/karl/src/commands packages/karl/scripts/test-all.ts docs`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/001-establish-work-governance.md`, `plans/002-add-crash-safe-run-journal.md`
- **Category**: direction
- **Planned at**: commit `1ab5a69`, 2026-07-11

## Why this matters

Karl can request broad Ivo context and pass a context ID to delegated work, but users cannot reliably inspect why files were selected or reproduce a pack later. Explicit manifests make context a reviewable input rather than hidden model state and give run recipes a stable context reference.

## Current state

- `packages/karl/src/context-store.ts:16-96` defines content IDs and metadata (`task`, files, tokens, budget) under `.karl/contexts/`.
- `packages/karl/src/orchestrator.ts:377-488` actually consumes Ivo packs from `.ivo/contexts/<id>.xml` and emits only ID/count/token summary.
- `packages/karl/src/orchestrator.ts:855-885` passes an optional Ivo context ID as `--context-file`.
- The two storage locations/contracts are not unified in the current implementation.

## Commands you will need

`bun run test`, `bun run check`, `bun run --cwd packages/karl test-skills`, and `git diff --check` must all exit 0.

## Scope

**In scope**: `packages/karl/src/context-store.ts`, `packages/karl/src/orchestrator.ts`, `packages/karl/src/commands/context.ts` (create if command routing warrants), `packages/karl/src/cli.ts`, `packages/karl/src/commands/completions.ts`, `packages/karl/scripts/test-all.ts`, `docs/cli-reference.md`, `docs/configuration.md`.

**Out of scope**: reimplementing Ivo, AI relevance learning, daemon file watching, Merkle trees, hidden automatic context, moving/deleting existing `.ivo` packs, remote context storage.

## Git workflow

Branch `advisor/004-context-manifests`; use imperative commits; no push/PR.

## Steps

### Step 1: Resolve the pack ownership contract

Document and encode an adapter that treats Ivo's XML as content and Karl's manifest as metadata. Do not silently move files. A manifest needs schema version, context ID, source provider, creation time, task, token budget/actual, ordered selected files with repo-relative path and content hash, optional selection reason, source HEAD, and pack content path.

**Verify**: fixture manifests round-trip and reject traversal/absolute selected-file paths.

### Step 2: Save manifests atomically

Write manifest through a temporary sibling plus atomic rename; never publish a manifest before referenced content exists. Existing packs without manifests remain readable as `legacy` with reduced metadata.

**Verify**: tests cover normal save, interrupted write, duplicate content ID, missing content, and legacy pack.

### Step 3: Add inspection and diff commands

Add `karl context show <id> [--json]` and `karl context diff <old> <new> [--json]`. Show files, hashes, token usage, source HEAD, additions/removals/changes, and missing/stale source files. Never dump full context unless an explicit content flag is supplied.

**Verify**: CLI fixture tests assert stable versioned JSON and deterministic diff ordering.

### Step 4: Link packs to runs

Record the manifest ID and hash in Plan 002's run start/phase event. `karl history <run> --events` must identify the pack used without copying its full content into the journal.

**Verify**: a fake run links to a pack and remains inspectable after source files change.

### Step 5: Document and gate

**Verify**: `bun run check && bun run --cwd packages/karl test-skills && git diff --check` → exit 0.

## Test plan

Cover safe paths, atomicity, legacy packs, stable IDs, manifest validation, source drift, deterministic diffs, explicit content display, and journal linkage. Use temporary directories only.

## Done criteria

- [ ] Every new pack has a versioned inspectable manifest.
- [ ] Existing Ivo packs remain usable.
- [ ] Show/diff are deterministic and safe.
- [ ] Runs reference packs by ID/hash rather than duplicating content.
- [ ] Full gates pass; scope is clean.

## STOP conditions

- Ivo's current output cannot provide selected file identities without changing the external Ivo project.
- Pack IDs are not content-stable as assumed.
- Compatibility requires deleting or rewriting existing context files.

## Maintenance notes

Keep manifests provider-neutral so a later context provider can implement the same contract. Selection reasons are evidence, not authority; never imply they prove context sufficiency.
