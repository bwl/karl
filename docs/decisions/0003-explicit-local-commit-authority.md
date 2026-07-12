# ADR 0003: Grant narrow authority for explicit local commits

- **Status**: Accepted
- **Date**: 2026-07-12

## Context

Karl protects `.git` during restricted runs. A user could explicitly ask Karl
to commit reviewed changes, but the Codex app-server thread still used
`workspace-write` with approvals disabled. `git commit` therefore failed when
Git tried to create `.git/index.lock`, after the model had already inspected,
grouped, and validated the changes.

Using danger-full-access would make the task succeed but would grant far more
authority than a local commit requires. Leaving the behavior unchanged would
make Karl claim support for explicit commit work that it cannot complete.

## Decision

- Detect narrow, affirmative commit intent in the operator's task.
- Keep the thread in `workspace-write` and change its approval policy to
  `on-request` only for that task.
- Approve only standalone `git add` and `git commit` commands whose working
  directory is inside the selected workspace.
- Reject shell command chains and every other escalated command, including
  push, reset, clean, checkout, restore, and worktree removal.
- Keep `.git`, `.karl`, and environment files protected for ordinary runs.
- Keep automatic commits, integration, publication, and cleanup outside Karl's
  product boundary.

## Consequences

- Explicit local commit tasks can complete without `--unrestricted`.
- Commit hooks may run as part of `git commit`; this is inherent in authorizing
  a repository commit and remains limited to an explicit operator request.
- Ambiguous discussion of commits does not grant authority. Karl may decline to
  commit when the task is not phrased as an affirmative action request.
- Future Git capabilities need their own explicit policy rather than expansion
  of this allowlist.
