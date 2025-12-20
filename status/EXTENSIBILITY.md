# Extensibility

Agent Skills, hooks, custom tools, and extension points.

---

## Agent Skills

Karl implements the [Agent Skills](https://agentskills.io) open standard.

### Skill Locations

- Global: `~/.config/karl/skills/<name>/`
- Project: `./.karl/skills/<name>/`

### Skill Structure

```
skill-name/
  SKILL.md           # Required: frontmatter + content
  README.md          # Optional: documentation
  scripts/           # Optional: executable scripts
  references/        # Optional: additional docs
  assets/            # Optional: static resources
```

### SKILL.md Format

```markdown
---
name: code-review
description: Review code for security and best practices
license: Apache-2.0
compatibility: karl >= 1.0
metadata:
  author: security-team
  version: "2.1"
allowed-tools: bash read
---

# Code Review Skill

You are a specialized security analyst...
```

### Skill Schema

```typescript
interface SkillMetadata {
  name: string;                    // Required: lowercase-with-hyphens
  description: string;             // Required: max 1024 chars
  license?: string;                // SPDX identifier
  compatibility?: string;          // Version constraint
  metadata?: Record<string, string>;
  'allowed-tools'?: string;        // Space-separated tool names
}
```

### Validation Rules

1. **Name:** Must match `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`
2. **Directory:** Must match skill name exactly
3. **Description:** Non-empty, max 1024 chars

### Loading Resolution

```typescript
const skillsPaths = [
  join(homedir(), '.config', 'karl', 'skills'),  // Global
  join(process.cwd(), '.karl', 'skills'),        // Project
];
```

---

## Hooks System

Lifecycle events for plugins to observe and react.

### Hook Types

```typescript
type HookName =
  | 'pre-task'    // Before task execution
  | 'post-task'   // After task completes
  | 'pre-tool'    // Before tool call
  | 'post-tool'   // After tool call
  | 'on-error';   // On any error
```

### Hook Locations

- Project: `./.karl/hooks/*.{js,ts,mjs,cjs}`
- Global: `~/.config/karl/hooks/*.{js,ts,mjs,cjs}`

### Hook Module Format

```typescript
// ~/.config/karl/hooks/analytics.ts
export default {
  'pre-task': async (event) => {
    console.log(`Starting: ${event.task}`);
  },
  'post-task': async (event) => {
    console.log(`Completed: ${event.result ? 'success' : 'error'}`);
  },
  'on-error': async (event) => {
    console.error(`Error in ${event.scope}: ${event.error}`);
  }
};
```

### Event Schemas

**TaskHookEvent:**
```typescript
{
  task: string;
  index: number;
  attempt: number;
  model: string;
  provider: string;
  result?: string;    // post-task only
  error?: string;     // post-task only
}
```

**ToolHookEvent:**
```typescript
{
  tool: string;
  input: unknown;
  output?: unknown;   // post-tool only
  success?: boolean;  // post-tool only
  error?: string;     // post-tool only
}
```

### Execution Order

```
pre-task hook
  -> For each tool:
     pre-tool hook -> Tool execution -> post-tool hook
  -> (tool calls continue)
post-task hook
on-error hook (if error occurred)
```

---

## Custom Tools

### Built-in Tools

| Tool | Description |
|------|-------------|
| `bash` | Execute shell commands |
| `read` | Read files (text + images) |
| `write` | Create/overwrite files |
| `edit` | Find/replace text |

### Tool Interface

```typescript
interface AgentTool<TParameters, TDetails> {
  name: string;
  label: string;
  description: string;
  parameters: TParameters;  // TypeBox schema
  execute: (
    toolCallId: string,
    params: Static<TParameters>,
    signal?: AbortSignal
  ) => Promise<AgentToolResult<TDetails>>;
}
```

### Custom Tool Definition

```typescript
// ~/.config/karl/tools/screenshot.ts
import { Type } from '@sinclair/typebox';

const schema = Type.Object({
  region: Type.Optional(Type.String()),
  window: Type.Optional(Type.String())
});

export default {
  name: 'screenshot',
  label: 'Screenshot',
  description: 'Capture a screenshot',
  parameters: schema,

  async execute(toolCallId, params) {
    const filename = `/tmp/screenshot-${Date.now()}.png`;
    await captureScreen(params, filename);
    return {
      content: [{ type: 'text', text: `Saved: ${filename}` }],
      details: { path: filename }
    };
  }
};
```

### Tool Loading

```typescript
// From config:
tools: {
  custom: ['~/.config/karl/tools/*.ts']
}
```

Custom tools are loaded via glob patterns and merged with built-ins.

---

## Config Stacks

Named configurations with inheritance.

### Schema

```json
{
  "extends": "default",
  "model": "opus",
  "skill": "code-review",
  "context": "Focus on security",
  "timeout": "30s"
}
```

### Inheritance

```typescript
// Child overrides parent
const resolved = {
  ...parentStack,
  ...childStack  // minus 'extends' field
};
```

Circular dependencies are detected and rejected.

---

## Extension Points Summary

| Extension | Location | Format | Use Case |
|-----------|----------|--------|----------|
| **Skills** | `~/.config/karl/skills/` | YAML + Markdown | Agent personas |
| **Hooks** | `~/.config/karl/hooks/` | JS/TS modules | Observability |
| **Tools** | `~/.config/karl/tools/` | TypeBox + execute | Custom capabilities |
| **Stacks** | `~/.config/karl/stacks/` | JSON with inheritance | Config profiles |

---

## Design Principles

1. **Local-first:** Project overrides global
2. **Graceful degradation:** Invalid extensions log warnings, don't crash
3. **Type safety:** TypeBox schemas for validation
4. **Async-first:** All extensions support async/await
5. **Error isolation:** Extension errors don't fail core operations
6. **Security:** Tools sandboxed to working directory (unless `--unrestricted`)
