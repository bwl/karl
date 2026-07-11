# Plan 001: Establish a durable product and work-governance contract

> **Executor instructions**: Follow this plan step by step. Run every verification command before continuing. Stop on any condition listed below; do not improvise. Update this plan's row in `plans/README.md` when complete.
>
> **Drift check (run first)**: `git diff --stat 1ab5a69..HEAD -- README.md AGENTS.md docs/current-consolidation-roadmap.md docs/run-architecture-roadmap.md .github`
> If these files changed, compare the current state below with the live repository and stop if the intended document roles have changed.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `1ab5a69`, 2026-07-11

## Why this matters

Karl has rich idea documents, roadmaps, local run history, and Git commits, but no single authoritative work queue or stable separation between product intent and changing status. `docs/current-consolidation-roadmap.md:99-109` already contains completed sandbox work under “Remaining Risks” and “Best Next Task.” Establish a repo-owned operating contract and tracker vocabulary before more autonomous execution is added.

This plan borrows Symphony's separation of issue tracker, repo-owned `WORKFLOW.md`, isolated execution, and structured observability from <https://github.com/openai/symphony/blob/main/SPEC.md>. It does not add a daemon or tracker integration.

## Current state

- `README.md` links both a current consolidation roadmap and an exploratory run-architecture roadmap.
- `docs/run-architecture-roadmap.md:10-13` says Karl must remain slim, personal, and agent-friendly.
- `packages/karl/src/orchestrator.ts:187-221` already discovers and prioritizes `WORKFLOW.md` as agent context.
- `AGENTS.md` defines code, test, commit, and `.karl/` runtime-state conventions.
- There is no `PRODUCT.md`, `WORKFLOW.md`, `docs/decisions/`, issue template, or tracker-state reference.
- Commit messages use short imperative summaries, for example `Harden Karl and add configuration diagnostics`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Full gate | `bun run check` | exit 0; typecheck, 41+ tests, build pass |
| Skills | `bun run --cwd packages/karl test-skills` | exit 0 |
| Whitespace | `git diff --check` | no output |

## Scope

**In scope**:
- `PRODUCT.md` (create)
- `WORKFLOW.md` (create)
- `docs/direction.md` (create)
- `docs/work-tracking.md` (create)
- `docs/decisions/0001-repo-owned-work-contract.md` (create)
- `.github/ISSUE_TEMPLATE/karl-work.yml` (create)
- `.github/ISSUE_TEMPLATE/config.yml` (create only if needed)
- `README.md`
- `docs/current-consolidation-roadmap.md`

**Out of scope**:
- Creating GitHub issues, labels, milestones, or Projects remotely
- Any agent daemon, polling loop, or issue-tracker API client
- Changing runtime behavior or parsing `WORKFLOW.md` front matter
- Deleting or rewriting the `ideas/` archive

## Git workflow

- Branch: `advisor/001-work-governance`
- Use one logical commit with an imperative message such as `Establish Karl work governance`.
- Do not push or open a PR without operator instruction.

## Steps

### Step 1: Define the stable product contract

Create `PRODUCT.md` with: target user; the thesis “Karl decides how an AI task should run, enforces boundaries, and leaves an inspectable receipt”; core principles (local-first, four-tool surface, explicit policy, composable CLI, inspectable advanced behavior); and non-goals (general workflow engine, multi-tenant control plane, marketplace, IDE platform, autonomous workspace deletion). Distinguish product principles from current implementation claims.

**Verify**: `rg -n "Target user|Product thesis|Principles|Non-goals|inspectable receipt" PRODUCT.md` → each section is present.

### Step 2: Define the repo-owned execution contract

Create a plain-Markdown `WORKFLOW.md` describing issue eligibility, isolated worktree requirements, protected paths, destructive-command approval, validation commands, commit/handoff expectations, failure handling, and retention of failed/recovered workspaces. Keep it compatible with the existing context discovery; do not invent YAML behavior the runtime does not parse.

**Verify**: `rg -n "Eligibility|Isolation|Protected|destructive|Validation|Handoff|Failure|workspace" WORKFLOW.md` → every policy area is present.

### Step 3: Define tracker states and issue readiness

Create `docs/work-tracking.md` with the authoritative lifecycle `Inbox -> Shaping -> Ready -> In Progress -> Human Review -> Done`, plus `Blocked` and `Parked`. Define Ready, Done, ownership, dependency notation, and the rule that run success does not imply issue completion. Define fields: type, area, priority, dependencies, acceptance criteria, verification, and handoff.

Create `.github/ISSUE_TEMPLATE/karl-work.yml` collecting those fields. It must support feature, reliability, spike, and decision work without embedding implementation-specific secrets.

**Verify**: `rg -n "Inbox|Shaping|Ready|In Progress|Human Review|Done|Blocked|Parked" docs/work-tracking.md` → all states appear; `git diff --check` → no output.

### Step 4: Separate direction from status

Create `docs/direction.md` with the six plan themes and links to `plans/`. State explicitly that status lives in the issue tracker and that `ideas/` is a design quarry. Convert `docs/current-consolidation-roadmap.md` into a dated historical handoff or add a prominent superseded banner; remove claims that completed work remains next.

Record the document-role decision in `docs/decisions/0001-repo-owned-work-contract.md`: context, decision, alternatives, consequences.

**Verify**: `rg -n "issue tracker|design quarry|plans/" docs/direction.md` → all policies present; `rg -n "superseded|historical" docs/current-consolidation-roadmap.md` → a clear status appears.

### Step 5: Link the durable artifacts

Update `README.md` so `PRODUCT.md`, `WORKFLOW.md`, direction, decisions, and work tracking are discoverable without presenting `ideas/` as shipped behavior.

**Verify**: `for f in PRODUCT.md WORKFLOW.md docs/direction.md docs/work-tracking.md docs/decisions/0001-repo-owned-work-contract.md; do rg -q "${f##*/}" README.md || exit 1; done` → exit 0.

### Step 6: Run the full gate

**Verify**: `bun run check && bun run --cwd packages/karl test-skills && git diff --check` → all exit 0.

## Test plan

This is documentation/configuration work. Validate the GitHub issue form as YAML through GitHub's documented schema or an available YAML parser. Run the full existing gate to catch accidental package changes.

## Done criteria

- [ ] All in-scope documents exist and have distinct stated roles.
- [ ] Tracker lifecycle, Ready, Done, and handoff are unambiguous.
- [ ] `WORKFLOW.md` contains safety and verification policy but no unsupported runtime configuration claims.
- [ ] The stale consolidation roadmap is marked historical/superseded.
- [ ] `bun run check`, skills tests, and `git diff --check` pass.
- [ ] No files outside scope and `plans/README.md` are modified.

## STOP conditions

- `WORKFLOW.md` has acquired a runtime parser or schema since commit `1ab5a69`.
- The repository already adopted another authoritative issue lifecycle.
- Implementing the issue form requires choosing or creating remote labels/projects; report the needed remote setup instead.
- Any step would delete idea history rather than classify it.

## Maintenance notes

The issue tracker owns changing status; version-controlled documents own policy and decisions. Reviewers should reject future roadmap checkboxes that duplicate tracker state. Revisit this contract before adding any daemon or autonomous dispatcher.
