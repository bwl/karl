# Karl Product Direction

`PRODUCT.md` is the stable product contract. The issue tracker owns changing
status. This document ranks current themes and points to executable plans; it is
not a checklist.

The documents under `ideas/` are a design quarry: they preserve useful raw
material without implying commitment or shipped behavior.

## Current sequence

1. **Work governance** — establish the product, workflow, tracker, and decision
   contracts. See [`Plan 001`](../plans/001-establish-work-governance.md).
2. **Crash-safe run journal** — persist bounded, redacted events before a run
   finishes. See [`Plan 002`](../plans/002-add-crash-safe-run-journal.md).
3. **Evidence-led execution** — prove one gated recipe in an isolated worktree.
   See [`Plan 003`](../plans/003-execute-evidence-led-recipe.md).
4. **Inspectable context packs** — make context selection reproducible and
   linkable. See [`Plan 004`](../plans/004-make-context-packs-inspectable.md).
5. **Progressive run inspection** — project the journal into concise live and
   historical views. See [`Plan 005`](../plans/005-add-progressive-run-inspection.md).
6. **Explicit model comparisons** — compare identical tasks and context without
   opaque ranking. See [`Plan 006`](../plans/006-add-explicit-model-comparisons.md).

Dependencies and current local plan status are indexed in
[`plans/README.md`](../plans/README.md). After tracker setup, issues are the only
authoritative status source.

## Deferred deliberately

- long-running issue polling or a Karl daemon;
- general DAG/workflow execution;
- automatic workspace deletion;
- a full-screen split-pane TUI;
- skill marketplaces, ratings, and team registries;
- automatic model learning or global capability rankings;
- enterprise policy suites and editor platforms.

Reconsider a deferred direction only when user evidence shows the smaller
primitive is insufficient and record that choice under `docs/decisions/`.

## Historical material

- [`current-consolidation-roadmap.md`](current-consolidation-roadmap.md) records
  the July 2026 reliability consolidation and is no longer a live tracker.
- [`run-architecture-roadmap.md`](run-architecture-roadmap.md) preserves
  exploratory architecture material; the numbered plans define current slices.
