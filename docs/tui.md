# TUI & The Ace Model

*Serve and done.* Like Karlović on the court — no baseline rallies, no long exchanges. Just an unreturnable first serve.

Karl uses a **TUI while working, clean print on exit** pattern.

## During Execution

A live TUI shows progress:

```
┌─────────────────────────────────────┐
│  ◍ karl                             │
│                                     │
│  analyzing auth.go...               │
│  ├───▣ read   auth.go (245 lines)   │
│  ├───▣ bash   rg "TODO" (3 matches) │
│  └───◴ thinking...                  │
│                                     │
│  ░░░░░░░░░░░░░░░░░░░░░▒▒▒▒  67%     │
└─────────────────────────────────────┘
```

## On Completion

TUI clears, result prints to stdout:

```
$ karl run "analyze auth.go for security issues"

Found 2 issues in auth.go:

1. [HIGH] Line 67: SQL injection via string concatenation
   → Use parameterized queries instead

2. [LOW] Line 112: Timing attack on password comparison
   → Use constant-time comparison

$ _
```

The work is done. The ace landed. Clean text you can scroll, copy, pipe, grep.

## Why This Matters

- No TUI artifacts in your terminal history
- Output is just text — works with `| less`, `> file.txt`, etc.
- The live view is for *you* while waiting; the result is for *the record*

## Quiet Mode

`--quiet` skips the TUI entirely — pure headless.

## Visual Language

| Symbol | Meaning |
|--------|---------|
| `◍` | Task complete |
| `○` | Task queued |
| `◴◵◶◷` | In progress (spinner) |
| `✗` | Task failed |
| `▣` | Tool succeeded |
| `☒` | Tool failed |

### Tool Traces (with --verbose)

```
◍ Task 1/2: fix the bug in parser.go
├───▣ read     parser.go (245 lines)
├───▣ bash     rg "parseToken" (3 matches)
├───▣ edit     parser.go:67-89
╰───▣ bash     go test ./... (passed)

Fixed the off-by-one error in parseToken()...
```

## TUI Implementation

The ephemeral TUI needs to:
1. Render in an alternate screen buffer (so it can vanish cleanly)
2. Use differential rendering (only redraw what changed — no flicker)
3. Exit cleanly and print result to main buffer
