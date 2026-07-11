# Tools

## Core Tools (4 Only)

Following pi's philosophy: minimal toolset, maximum capability.

| Tool | Purpose |
|------|---------|
| `bash` | Execute shell commands (subsumes grep, glob, find) |
| `read` | Read file contents (text + images) |
| `write` | Create or overwrite files |
| `edit` | Surgical find/replace modifications |

### Current workspace policy

Unless a run uses `--unrestricted`:

- `write` and `edit` targets must remain inside the canonical working directory. Karl resolves symlinks and the nearest existing ancestor, so lexical traversal and symlink escapes are rejected.
- `write` and `edit` reject `.git/**`, `.karl/**`, `.env`, and `.env.*` at the workspace root.
- a `bash` working-directory override must remain inside the canonical workspace.
- `read` is not workspace-scoped; it can read paths outside the working directory.
- shell writes require the platform sandbox (Seatbelt on macOS, bubblewrap on Linux). Restricted bash fails closed when that facility is missing or unusable; it never silently runs unsandboxed.
- the sandbox makes the workspace writable while protecting `.git`, `.karl`, root `.env`, and root `.env.*` as far as each OS mechanism permits. Seatbelt can deny the names whether or not they exist. Bubblewrap re-mounts existing protected paths read-only, but cannot reserve a protected path that does not exist when the sandbox starts.

`--unrestricted` is the intentional bypass: it bypasses workspace mutation checks and disables process sandboxing. Use it only when unrestricted host access is intended.

### Why not glob/grep tools?

They're just `bash` commands. The model knows `find`, `grep`, `rg`, `fd`. Don't duplicate what the shell already does well.

### Why separate read from bash cat?

Read handles:
- Binary detection
- Image encoding (for vision models)
- Large file truncation with offset/limit
- Consistent error messages

## Custom Tools (Plugins)

Extend Karl without forking. Drop a file in `~/.config/karl/tools/`:

```typescript
// ~/.config/karl/tools/jira.ts
import { defineTool } from 'karl-core';

export default defineTool({
  name: 'jira',
  description: 'Create or update Jira tickets',
  parameters: {
    type: 'object',
    properties: {
      action: { enum: ['create', 'update', 'comment'] },
      ticket: { type: 'string' },
      content: { type: 'string' }
    },
    required: ['action']
  },
  async execute({ action, ticket, content }) {
    // Your Jira API logic
    return { success: true, ticket: 'PROJ-123' };
  }
});
```

Tools are loaded at startup. No recompilation needed.
