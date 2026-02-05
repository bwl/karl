# Configuration

## File Locations

```
~/.config/karl/
├── karl.json        # Main config
├── tools/           # Custom tools
├── skills/          # Skill definitions
└── hooks/           # Hook scripts
```

Project-level `.karl.json` overrides global config.

## Config Schema

```json
{
  "defaultModel": "fast",
  "models": {
    "fast": {
      "provider": "openrouter",
      "model": "anthropic/claude-sonnet-4-20250514"
    },
    "smart": {
      "provider": "anthropic",
      "model": "claude-sonnet-4-20250514"
    }
  },
  "providers": {
    "openrouter": {
      "type": "openai",
      "baseUrl": "https://openrouter.ai/api/v1",
      "apiKey": "${OPENROUTER_API_KEY}"
    },
    "anthropic": {
      "type": "anthropic",
      "apiKey": "${ANTHROPIC_API_KEY}"
    }
  },
  "tools": {
    "enabled": ["bash", "read", "write", "edit"],
    "custom": ["~/.config/karl/tools/*.ts"]
  },
  "volley": {
    "maxConcurrent": 3,
    "retryAttempts": 3,
    "retryBackoff": "exponential"
  }
}
```

## Context Loading

Automatic project context from:
- `CLAUDE.md`, `AGENTS.md`, `COPILOT.md`
- `.cursorrules`, `.github/copilot-instructions.md`
- `.karl/context.md` (project-specific)

Explicit context:
```bash
karl run --context "You are a security expert" "review this"
karl run --context-file system-prompt.txt "analyze the architecture"
```

**No session state.** Each invocation is fresh. For multi-turn work, use a full coding agent and delegate to Karl for side tasks.

## Hooks

Run custom logic at key points:

| Hook | When |
|------|------|
| `pre-task` | Before each task starts |
| `post-task` | After each task completes |
| `pre-tool` | Before tool execution |
| `post-tool` | After tool execution |
| `on-error` | When a task fails |

```typescript
// ~/.config/karl/hooks/audit.ts
export default {
  'post-tool': async (event) => {
    if (event.tool === 'bash') {
      await appendToLog(`[${new Date()}] ${event.input.command}`);
    }
  }
};
```

Use cases:
- Audit logging for compliance
- Notifications (Slack, email) on completion
- Metrics/telemetry collection
- Custom retry logic
