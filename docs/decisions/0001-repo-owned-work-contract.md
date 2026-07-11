# ADR 0001: Use a repo-owned work contract and external status tracker

- **Status**: Accepted
- **Date**: 2026-07-11

## Context

Karl accumulated a large idea archive, narrative roadmaps, local SQLite run
history, and Git outcomes. These artifacts preserve different kinds of evidence
but did not establish one authoritative work lifecycle. A roadmap could claim a
task remained next after the implementation had already landed.

OpenAI Symphony separates tracker work, repository-owned workflow policy,
isolated execution, coordinator state, and structured observability. Karl needs
the same separation without becoming a continuously polling scheduler.

## Decision

- The issue tracker owns changing work status.
- `PRODUCT.md` owns stable product thesis, principles, and non-goals.
- `WORKFLOW.md` owns repository execution and handoff policy.
- `docs/direction.md` ranks themes and links work without duplicating status.
- `plans/` contains self-contained executor instructions.
- `docs/decisions/` preserves consequential choices and rejected alternatives.
- Local run history is operational evidence; commits, PRs, and issue handoffs
  are durable shared outcomes.
- Agent success normally recommends `Human Review`, not `Done`.

## Alternatives considered

### Keep status in Markdown roadmaps

Rejected because status duplicates implementation reality and drifts without a
coordinator or tracker transition.

### Use only GitHub issues

Rejected because issue state does not replace versioned product principles,
repository safety policy, or architectural decisions.

### Adopt Symphony as Karl's runtime

Deferred. Its work-item, workspace, state, and observability concepts are useful,
but its daemon polling and Codex app-server specialization are not required to
establish Karl's current workflow.

### Store everything in Karl's SQLite history

Rejected because a local database is not shared project memory and may be
unavailable to other contributors or automation hosts.

## Consequences

- Maintainers must resist adding live checklists to direction documents.
- Work should not enter autonomous execution until it satisfies Ready.
- Runtime receipts must link to a work item and durable outcome when available.
- Remote tracker setup remains an explicit operator action.
- Future daemon or tracker integration must conform to this separation or
  supersede this ADR explicitly.
