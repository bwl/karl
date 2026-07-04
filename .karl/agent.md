# Karl Project Harness

Karl is intentionally slim and personal. Do not turn this repository into a universal agent framework or vendor a broad harness just to track the agent landscape.

Use external agent projects as weather reports:

- Pi and OMP are references for provider/model/tool trends, not architectural targets.
- Prefer tiny compatibility shims over new runtime dependencies.
- Raw provider and model strings are allowed when the configured wire protocol supports them.
- Local project choices beat synced catalogs.

Treat these `.karl/` paths as authored repository files when present:

- `.karl/agent.md`, `.karl/agent-context.md`, and `.karl/context.md` are project guidance.
- `.karl/worktree.md` is scratch-worktree bootstrap guidance for delegated agents.
- `.karl/stacks/*.json` are Karl verbs and execution profiles.
- `.karl/skills/**` are project-specific agent skills.

Treat these `.karl/` paths as disposable runtime state:

- `.karl/status.json`
- `.karl/status/**`
- `.karl/jobs/**`
- `.karl/logs/**`
- `.karl/agent-state.json`

When committing, include authored harness files with the code they describe. Do not skip them merely because `.karl/` is a dot directory.
