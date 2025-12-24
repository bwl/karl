# Karl TUI Implementation Plan

## Overview
Build split-pane TUI for Karl Agent runs per [proposal](ideas/karl-agent-split-ui.md). Target: MVP in 5 days.

## Prerequisites
- `bun add ink react @types/react ink-text-input ink-box ink-spinner ink-select-input globby zustand`
- Terminal: 120+ cols, UTF-8
- Update `packages/karl/src/cli.ts` for `--tui` flag

## Phases

### Phase 1: TUI Skeleton (Day 1)
```
packages/karl/src/tui/
├── index.ts          # Main Ink App
├── panes/
│   ├── chat.tsx      # Left: conversation
│   └── log.tsx       # Right: agent stream
├── components/
│   ├── resizer.tsx
│   └── statusbar.tsx
└── hooks.ts          # Event bus
```
- Run static split: Left box "Chat", Right "Logs"
- Keyboard: q/esc quit, tab focus
- Handle SIGWINCH resize

Test: `bun run dev --tui`

### Phase 2: Agent Integration (Day 2)
- Extend `AgentRunner` with EventEmitter:
  ```ts
  import { EventEmitter } from 'events';
  class AgentRunner extends EventEmitter {
    emitThink(text: string) { this.emit('think', text); }
    emitToolCall(call: ToolCall) { this.emit('tool_call', call); }
    // etc.
  }
  ```
- In TUI: subscribe to events, append to log pane
- Stream LLM tokens: split/filter to chat/log

### Phase 3: Rendering & Input (Days 3-4)
**Chat Pane**:
- Markdown-lite: code blocks, tables, links
- Input: bottom text field for follow-ups
**Log Pane**:
- Syntax highlight: thoughts=blue, tools=green, obs=yellow
- Search/filter: `/` key
**Status Bar**: Model, tokens, runtime, errors

Polish:
- Spinner for loading tools
- Collapsible log sections
- Copy to clipboard (term escape seq)

### Phase 4: Flags & Stacks (Day 5)
- CLI: `karl run --tui`, `karl stacks edit default --tui=true`
- Stack schema: `"tui": true`
- Graceful fallback: `if (!supportsTUI()) useClassic();`
- Docs: Update README with screenshots

## Milestones & Commands
| Step | Command | Success Criteria |
|------|---------|------------------|
| 1 | `bunx ink --help` | Ink CLI works |
| 2 | `bun run dev --tui` | Split screen appears |
| 3 | `karl run "echo hi" --tui` | Agent runs, logs stream |
| 4 | Resize term | Panes adapt |

## Risks & Mitigations
- **Bun+Ink compat**: Test early; fallback to node if issues
- **Performance**: 60fps target; virtualize long logs
- **Event loop block**: All async, yield to Ink render loop
- **Cross-platform**: Test macOS/Linux; Windows via WSL

## Post-MVP
- Themes (dark/zen)
- Multi-agent (tabs)
- Record/replay sessions
- Export chat to MD

**Total Effort**: 40h. Start with Phase 1 PoC today.
