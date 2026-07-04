# Karl Worktree Notes

`karl magic --worktree` runs from a detached scratch worktree rooted at `HEAD`.
Uncommitted changes in the source tree are not copied. Use `--require-clean` when
that would be ambiguous.

For this repository, verify implementation changes from the worktree with:

- `bun run typecheck`
- `cd packages/karl && bun run test-skills` when skill loading or `.karl/` harness behavior changes

Leave the worktree in place for the caller to inspect and integrate. Do not remove
it during the delegated run unless the caller explicitly asks.
