# Karl Agent Split UI Proposal

## Problem
Running complex agent tasks with `karl run` floods the terminal with interleaved thinking steps, tool calls, observations, and final outputs. Users struggle to focus on results amid the noise, especially for long-running tasks.

## Proposal
Introduce an optional **dual-pane TUI** (Text User Interface) for agent runs, activated via `karl run --tui` or stack config.

**Layout**:
- **Left Pane (70% width)**: Clean conversation view
  - User prompt
  - Rendered agent responses & final results
  - Simple markdown rendering (tables, code blocks)
- **Right Pane (30% width)**: Live agent log
  - Raw thoughts (`&lt;think&gt;`)
  - Tool calls & inputs
  - Tool observations & outputs
  - Errors & retries
  - Auto-scroll with pause toggle

**Interactions**:
- Keyboard shortcuts: `Tab` switch panes, `Space` pause logs, `q`/Esc quit
- Resize: Mouse or `Ctrl + ←/→`
- Fallback: Single-pane mode if terminal too small (&lt;120 cols)

## Benefits
- **Clarity**: Separate signal (results) from noise (reasoning)
- **Monitoring**: Real-time visibility into agent behavior without distraction
- **Debugging**: Pinpoint tool failures or loops easily
- **UX Lift**: Professional feel, like VSCode split editor or tmux

## ASCII Mockup
```
┌──────────────────────────────┬────────────────┐
│ karl run "deploy app"        │ [AGENT LOG]    │
│                              │                │
│ > Deploying app v1.2...      │ &lt;think&gt; Analyze │
│                              │ codebase...    │
│ ✅ Deployed to prod.         │ Tool: bash     │
│ Logs: [link]                 │ cd src &amp;&amp; bun  │
│                              │ Obs: success   │
│ [Enter new task]             │                │
└──────────────────────────────┴────────────────┘
Status: Idle  [q]uit [Tab]switch [Space]pause
```

## Tech Considerations
- **Library**: Ink (React-based TUI for Node/Bun)
  - Pros: Expressive, streaming-friendly, hooks into stdin/stdout
  - Bun support: Full (ESM, fast)
- **Events**: Extend agent runner to emit structured events
  ```ts
  emitter.on('think', (text) => logPane.append(`&lt;think&gt; ${text}`))
  emitter.on('tool_call', ({name, args}) => logPane.append(...))
  ```
- **Streaming**: Agent LLM output streams to both panes (filtered)
- **Terminal Compat**: iTerm2, Kitty, WezTerm; graceful degrade on basic xterm

## Alternatives Explored
| Option | Pros | Cons |
|--------|------|------|
| tmux panes | Native split | Complex setup, not portable |
| Single pane w/sections | Simple | Still cluttered on scroll |
| Web UI (localhost:karl) | Rich | Leaves CLI purity |
| Log file + tail | External | No integration |

Ink TUI wins for balance.

## Related
- [TUI Plan](plan.md)
- Agent Skills spec for event hooks
