# ADR 0002: Use OpenTUI for bounded interactive workspaces

- **Status**: Accepted
- **Date**: 2026-07-12

## Context

Karl's original configuration interface grew into two competing renderers in a
single command file. The active interface exposed every category as one long
document, duplicated navigation state, and depended on neo-blessed. It made a
deliberate configuration task feel more difficult than the surrounding CLI.

Three disposable interface directions were prototyped. The selected direction
combines persistent category navigation with a scrollable, action-first main
pane. A compact filter remains available without framing configuration as a
search or command-palette task.

## Decision

- Use pinned OpenTUI Core for bounded, full-screen interactive workspaces.
- Give `karl config` a persistent sidebar, scrollable actions, and an optional
  `/` filter.
- Keep operational run output line-oriented and journal-backed as described in
  `docs/tui.md`.
- Keep `karl config doctor`, `show`, `edit`, and `set` stable and scriptable.
- Separate data/action modeling from rendering so other bounded workspaces can
  reuse the shell without coupling their domain logic to configuration.

## Alternatives considered

### Keep neo-blessed and restyle the existing interface

Rejected because the problem included duplicated state and architecture, not
only presentation. Retaining the old renderer would preserve the largest source
of complexity.

### Make configuration a command palette

Rejected because search is useful but should not be required. Configuration has
stable categories, and scrolling through visible options supports discovery.

### Use a browser-based local settings page

Rejected because it would add a server/browser lifecycle to a local CLI task
and separate configuration from Karl's normal terminal context.

## Consequences

- Karl gains a native dependency and therefore pins OpenTUI to a stable version.
- Interactive workspace behavior needs PTY and terminal-size coverage in
  addition to pure action-model tests.
- History viewing and `karl agent` are candidates for the same shell, but each
  needs its own interaction design and must not turn live run output into a
  decorative full-screen surface.
