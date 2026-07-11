# Karl Product Contract

## Target user

Karl is for developers who want to invoke capable AI work from the terminal
without adopting a large agent platform. They value local control, Unix
composition, explicit safety boundaries, and evidence they can inspect after a
run.

## Product thesis

Karl decides how an AI task should run, enforces the boundaries, and leaves an
inspectable receipt.

A simple request should remain one fast command. A consequential repository
task may use context preparation, isolation, a human gate, implementation, and
verification, but that structure must reduce operator burden rather than expose
a workflow engine.

## Principles

### Local first

Project policy, authored context, worktrees, status, and receipts are local and
inspectable. Remote providers may perform inference, but they do not own Karl's
filesystem or approval policy.

### Small execution surface

Karl's four built-in tools—`bash`, `read`, `write`, and `edit`—are a deliberate
constraint. New behavior should usually compose those tools, stacks, skills,
and typed run policies rather than add another privileged mechanism.

### Models propose; Karl enforces

Models may classify tasks or propose a process. Deterministic code validates
tool scope, workspace policy, approval gates, budgets, and verification before
execution.

### Receipts over reassurance

A successful message is not evidence that work is correct. Karl should preserve
the run identity, inputs, context reference, tool events, changed files,
verification, terminal reason, and residual risk needed for review or recovery.

### Composable by default

Stdin, stdout, exit codes, JSON, files, and Git remain first-class interfaces.
Interactive presentation is an optional projection over the same underlying
events.

### Advanced paths stay inspectable and optional

Direct runs remain available. Routing, recipes, comparisons, context packs, and
agent coordination must be explainable, reproducible, and easy to ignore.

### Personality serves usability

Karl is confident, concise, and occasionally playful. Tennis language is an
identity accent, not a substitute for literal errors, safety warnings, or
recovery instructions.

## Near-term direction

1. Establish durable product and work governance.
2. Make run history crash-safe and useful for diagnosis and recovery.
3. Execute one evidence-led patch recipe through an isolated worktree.
4. Make context packs inspectable and reproducible.
5. Project the run journal into concise, progressive terminal output.
6. Support explicit, reproducible model comparisons.

Current work and dependencies are indexed in [`plans/README.md`](plans/README.md).
Changing status belongs in the issue tracker, not this contract.

## Non-goals

Karl is not currently trying to become:

- a general-purpose workflow or distributed job engine;
- a continuously polling project-management daemon;
- a multi-tenant control plane or enterprise policy suite;
- an IDE platform or editor-extension ecosystem;
- a public skill marketplace, ratings service, or model leaderboard;
- an opaque automatic-learning system that changes behavior without an
  inspectable configuration change;
- an owner of automatic commits, merges, pushes, or destructive workspace
  cleanup.

These are product boundaries, not permanent prohibitions. Crossing one requires
an explicit decision record showing why the simpler Karl is insufficient.
