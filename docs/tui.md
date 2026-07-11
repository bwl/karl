# Terminal Output and Run Inspection

Karl uses a concise live status line and durable journal inspection. It does
not use an alternate-screen, split-pane, mouse-driven, or full-screen TUI.

The journal is the source of truth. Terminal output is a bounded projection:

- `summary` is the default. It shows tool/phase outcomes while running and a
  compact receipt with outcome, duration, changed-file count, validation, and
  run ID.
- `--verbose` adds bounded tool and result summaries. It never streams model
  reasoning as progress.
- `--trace` adds bounded, redacted journal detail and points to the complete
  stored event timeline.
- `--json` keeps stdout machine-only and suppresses spinner/status decoration.

After any recorded run:

```bash
karl history <run-id>
karl history <run-id> --verbose
karl history <run-id> --events
karl history <run-id> --events --full
```

Default nested-agent output is capped. When content is omitted, Karl prints an
explicit omission marker and, when available, this recovery command:

```text
Inspect: karl history <run-id> --events
```

`--full` expands only payloads that were already redacted and bounded when
written. It cannot reveal discarded secrets or hidden model reasoning.

## Pipes and terminal capability

Final task text remains on stdout. Live progress and receipt decoration use
stderr and appear only when appropriate for a terminal. Non-TTY output,
`--plain`, `NO_COLOR`, and JSON mode avoid cursor animation and ANSI-dependent
meaning, so `|`, redirection, `less`, and log capture remain reliable.

## Why a full TUI is deferred

A full-screen UI would add terminal-state recovery, rendering, and dependency
risk without improving the underlying evidence. The current surface keeps the
valuable hierarchy—summary first, details on demand—while remaining Unix-native.
An optional future UI can consume the same journal without changing run
semantics.
