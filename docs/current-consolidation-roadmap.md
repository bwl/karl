# Karl Current Consolidation Roadmap and Handoff

**Status:** current engineering roadmap and handoff
**Last updated:** 2026-07-11
**Scope:** focused consolidation before new product surface

This document preserves the current product/engineering assessment and distinguishes shipped behavior from planned work. The longer-term run architecture ideas remain exploratory in [`run-architecture-roadmap.md`](run-architecture-roadmap.md); this document is the near-term source of truth.

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

## Remaining Risks and Decisions

1. **Shell fail-open on unsupported hosts:** `sandboxCommand` still warns and continues when bubblewrap is unavailable or the platform is unsupported. Decide whether restricted runs should fail closed, require an explicit opt-out, or retain compatibility. This is the most important remaining security decision.
2. **Protected shell paths:** `protectedPaths` are not translated into deny rules inside writable roots. Direct `write`/`edit` are protected, but sandboxed bash can still mutate `.git`, `.karl`, or `.env` within the writable workspace. Fixing this requires careful Seatbelt and bubblewrap mount/rule ordering and cross-platform tests.
3. **Read policy:** reads remain global. If read-only routes are expected to mean “repository-only,” introduce a separate explicit read scope rather than silently changing the current tool contract.
4. **TOCTOU:** canonical authorization occurs before mutation. A hostile concurrent process could swap path components afterward. Full descriptor-relative mutation would add complexity and should be justified by threat model.
5. **CI platform coverage:** normal CI is Linux-only; releases test Linux and macOS on tags. Sandbox policy generation and enforcement deserve isolated tests that do not depend on host availability.

## Best Next Task

Harden bash sandbox behavior as one focused slice: make unavailable sandbox handling an explicit policy (prefer fail-closed for restricted runs), enforce protected workspace paths for shell writes on both Seatbelt and bubblewrap, and add host-independent policy-generation tests plus available-platform smoke tests. Do not begin config diagnostics until that boundary is resolved.
