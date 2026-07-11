# Karl July 2026 Consolidation Handoff

**Status:** historical; completed and superseded as a live roadmap
**Last updated:** 2026-07-11
**Scope:** focused consolidation before new product surface

This document preserves the assessment, implementation record, and acceptance
criteria for the July 2026 reliability consolidation. It is not a current work
tracker. Product direction now lives in [`direction.md`](direction.md), changing
status belongs in the issue tracker, and executor-ready work lives under
[`plans/`](../plans/).

## Assessment

Karl already has a broad CLI and an intentionally small four-tool agent surface. The highest-value work is not another framework or command: it is making the existing runtime reliably testable and ensuring its filesystem claims match enforcement.

At the start of this pass:

- typecheck and compiled build passed;
- the test suite failed because it tried to execute a compiled binary through `bun` as source;
- releases built artifacts without running typecheck or tests, and there was no pull-request CI;
- `write` and `edit` used lexical path-prefix checks, which allowed symlink escapes;
- `bash.cwd` had no workspace-boundary check;
- sandbox `protectedPaths` were declared but not enforced by Seatbelt or bubblewrap;
- `.git`, `.karl`, and environment files therefore lacked deterministic tool-level write protection;
- reads were intentionally unrestricted, while mutation was described as workspace-limited.

## Priority 1 — Green, Reproducible Quality Gate

**Rationale:** a failing or machine-state-dependent baseline makes every later security/config change risky.

**Current behavior after this pass:**

- `bun run check` runs typecheck, the local test suite, and a compiled build;
- CLI subprocess tests execute `src/cli.ts`, so they do not depend on stale or absent `dist` output;
- pull requests and pushes to `master` run the same gate on Linux;
- tag releases run typecheck and tests before producing each platform artifact;
- the package-local build no longer copies into `~/.local/bin` as a side effect.

**Acceptance criteria:**

- [x] `bun run typecheck` passes.
- [x] `bun run test` passes without a local model provider.
- [x] `bun run build` succeeds.
- [x] CI uses a frozen lockfile and runs the combined gate.
- [x] release artifacts are gated by typecheck and tests.

## Priority 2 — Central Workspace/Path Policy

**Rationale:** tool-level filesystem checks are the portable safety boundary. Platform sandboxes are useful defense in depth but may be unavailable and must not be the only enforcement.

**Current behavior after this pass:**

- restricted tool creation canonicalizes the workspace root and fails closed if it does not exist or cannot be resolved;
- `bash.cwd`, `write`, and `edit` share one canonical workspace resolver;
- existing symlinks and the nearest existing ancestor of a new target are resolved before authorization;
- traversal and symlink escapes are rejected;
- writes/edits to `.git/**`, `.karl/**`, `.env`, and `.env.*` at workspace root are rejected;
- `--unrestricted` remains the explicit bypass and also disables the process sandbox, matching prior behavior;
- `read` remains able to read outside the workspace by design; this pass only consolidates mutation and shell-working-directory policy;
- shell command contents are not parsed. Restricted bash now requires a usable OS sandbox and fails closed with an actionable diagnostic when Seatbelt or bubblewrap is unavailable;
- `--unrestricted` is the sole intentional bypass and disables both workspace checks and process sandboxing;
- Seatbelt denies writes to `.git`, `.karl`, root `.env`, and root `.env.*` even inside the writable workspace;
- bubblewrap re-binds existing protected paths read-only after mounting the workspace writable. Its mount model cannot reserve protected names that do not exist at sandbox startup.

**Security regression acceptance criteria:**

- [x] normal in-workspace write/edit succeeds.
- [x] `..` traversal outside the workspace is rejected.
- [x] a symlink inside the workspace cannot target an outside write/edit.
- [x] `bash.cwd` cannot select an outside directory.
- [x] protected Karl, Git, and environment paths reject mutation.
- [x] an unresolvable workspace root fails closed.
- [x] restricted bash fails closed when its OS sandbox is absent or unusable.
- [x] policy-generation tests cover protected paths without depending on the host OS.
- [x] an available-host smoke test executes the generated platform sandbox command.

## Priority 3 — Config Diagnostics (Implemented)

**Rationale:** once the baseline and path boundary are trustworthy, Karl should explain invalid or shadowed configuration without adding a broad validation framework.

**Proposed acceptance criteria:**

- `karl config doctor` (or a similarly small existing-command extension) reports the files and precedence used for providers, models, stacks, and project overrides;
- malformed JSON includes the source path and actionable parse detail;
- missing provider/model references and invalid stack fields are reported before a run;
- secrets are redacted;
- machine-readable output has a stable, documented shape;
- diagnostics return non-zero only for errors, not warnings.

**Implemented:** `karl config doctor [--json]` now scans the existing config
layers without relying on loaders that silently skip bad entry files. It reports
winning entry sources and shadowing, malformed/ignored files, authentication
readiness (without credential values), model/provider and stack
model/parent/skill references, inheritance cycles, and host sandbox readiness.
The JSON contract is versioned as schema 1 and tests cover success, broken
references/files, stable shape, and secret redaction.

**Deferred:** field-by-field provenance, exhaustive schema/type validation,
remote provider/model connectivity probes, and a generalized config framework.
Current provenance remains entry-level where source paths are reliable.

## Closeout and deferred risks

The quality gate, fail-closed restricted shell behavior, protected workspace
paths, and configuration diagnostics described above landed together in commit
`1ab5a69`. This handoff's former “Best Next Task” became stale once those slices
were implemented, which is why live status no longer belongs in this document.

Known deferred questions remain useful inputs to future issues:

1. Reads remain global; repository-only read routes need a separate explicit
   scope rather than a silent contract change.
2. Canonical path authorization still has a theoretical time-of-check/time-of-use
   race against a hostile concurrent process.
3. Normal CI is Linux-only; macOS sandbox behavior is exercised on tagged
   release jobs and conditional host smoke tests.
4. Configuration provenance remains entry-level rather than field-by-field.
5. Provider connectivity probes and exhaustive schema validation remain
   deferred.

Current priorities and dependencies are maintained in
[`docs/direction.md`](direction.md) and [`plans/README.md`](../plans/README.md).
