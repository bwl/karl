# Tools

## Core Tools (4 Only)

Following pi's philosophy: minimal toolset, maximum capability.

| Tool | Purpose |
|------|---------|
| `bash` | Execute shell commands (subsumes grep, glob, find) |
| `read` | Read file contents (text + images) |
| `write` | Create or overwrite files |
| `edit` | Surgical find/replace modifications |

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
