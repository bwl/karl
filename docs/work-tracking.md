# Karl Work Tracking

The issue tracker is the authoritative source for changing work status. Product
documents explain direction; plans specify execution; decisions preserve why;
commits and PRs preserve outcomes. Do not duplicate live status in roadmap
Markdown.

## Lifecycle

```text
Inbox -> Shaping -> Ready -> In Progress -> Human Review -> Done
            |          |          |
            v          v          v
          Parked     Blocked    Blocked
```

### Inbox

An unvetted observation, request, or idea. It may be valuable, but no execution
commitment exists.

### Shaping

The problem, outcome, constraints, alternatives, and dependencies are being
resolved. Spikes and decisions may be created here.

### Ready

The item can be executed by someone without access to the shaping conversation.
It satisfies the Ready definition below.

### In Progress

One owner or run has claimed the item. The issue links its branch/worktree and
current run identifier. A claim prevents duplicate autonomous dispatch.

### Human Review

Implementation has reached a workflow-defined handoff. Evidence and validation
are available, but a human still owns acceptance and integration.

### Done

The outcome and Done definition are satisfied. Agent exit status alone cannot
produce this state.

### Blocked

Execution cannot proceed without a named dependency, decision, permission, or
external-state change. Record the blocker and the condition that will unblock
the item.

### Parked

The work is intentionally not being pursued. Record why so the same idea is not
repeatedly reshaped without new evidence.

## Ready definition

A work item is Ready only when it has:

- a concrete problem and desired outcome;
- explicit non-goals and file/system boundaries;
- acceptance criteria that can be checked;
- exact validation commands or a plan to establish them;
- dependencies and blockers identified;
- safety, privacy, and compatibility constraints;
- a handoff expectation;
- a linked implementation plan for medium/high-risk work.

## Done definition

A work item is Done only when:

- acceptance criteria are met;
- required tests and repository gates pass;
- skipped checks and residual risks are accepted;
- documentation and decisions are updated where behavior changed;
- the reviewed change is integrated in the intended branch;
- durable outcome links—commit, PR, release, or decision—are attached;
- temporary workspaces have an explicit retain/cleanup decision.

## Work-item fields

Every item records:

- **Type**: feature, reliability, spike, decision, docs, or maintenance
- **Area**: journal, routing, context, UX, models, security, configuration, or release
- **Priority**: P1, P2, or P3
- **Outcome** and **non-goals**
- **Acceptance criteria** and **verification**
- **Dependencies** using issue links
- **Safety constraints**
- **Plan** link when applicable
- **Owner/claim**, run ID, and workspace while In Progress
- **Handoff evidence** and recommended next state

## Ownership and transitions

Only one active owner or autonomous run may claim an item. The coordinator owns
claim/retry/reconciliation state; workers report events and outcomes but do not
mutate coordinator state directly.

Humans may move work between any states with an explanation. Automated flows
may claim Ready work, move it to In Progress, and recommend Human Review. They
must not mark work Done unless the repository workflow explicitly delegates
that authority.

## Plans and issues

The issue states why and what. A file under [`../plans/`](../plans/) provides the
self-contained how for an executor. Copy stable acceptance and STOP conditions
into the issue, link the plan, and keep changing execution status only in the
tracker.
