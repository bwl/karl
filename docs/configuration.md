# Configuration

## File Locations

```
~/.config/karl/
├── karl.json        # Main config
├── tools/           # Custom tools
├── skills/          # Skill definitions
└── hooks/           # Hook scripts
```

Project-level `.karl.json` overrides global config. Provider and model files in
`~/.config/karl/{providers,models}/` override inline entries; stack files are
loaded from global and then project `.karl/stacks/` directories.

## Configuration Diagnostics

```bash
karl config doctor
karl config doctor --json
```

The doctor reports effective provider/model/stack entries, their reliable source
(file or inline JSON pointer), broken references and malformed/ignored files,
authentication readiness, and restricted-bash sandbox readiness. Authentication
status never includes API keys or OAuth credentials. Warnings (for example a
missing credential or unavailable host sandbox) do not fail the command; config
errors produce exit status 1.

JSON output has a versioned, stable top-level shape:

```json
{
  "schemaVersion": 1,
  "ok": true,
  "sources": {},
  "effective": {},
  "sandbox": {},
  "diagnostics": [],
  "summary": { "errors": 0, "warnings": 0 }
}
```

Provenance is limited to layers Karl can identify reliably today. The doctor
shows the winning source for providers, models, and stacks and reports shadowed
entries, but does not provide field-by-field merge provenance. It validates
stack model, parent, and skill references; deeper schema validation and remote
provider/model connectivity probes are deferred.

## Config Schema

```json
{
  "defaultModel": "fast",
  "models": {
    "fast": {
      "provider": "openrouter",
      "model": "anthropic/claude-sonnet-4-20250514"
    },
    "fusion": {
      "provider": "openrouter",
      "model": "openrouter/fusion",
      "request": {
        "plugins": [{
          "id": "fusion",
          "analysis_models": [
            "~anthropic/claude-opus-latest",
            "~openai/gpt-latest",
            "~google/gemini-pro-latest"
          ],
          "model": "~openai/gpt-latest"
        }],
        "tool_choice": "required"
      }
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
    "wafer": {
      "type": "openai",
      "baseUrl": "https://pass.wafer.ai/v1",
      "apiKey": "${WAFER_API_KEY}"
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

## OpenRouter Request Passthrough

Models and stacks can include a `request` object. For OpenAI-compatible
providers, Karl merges it into the `/chat/completions` body after setting the
core fields (`model`, `messages`, `stream`, and `stream_options`). This is for
provider/router knobs such as OpenRouter `plugins`, `tool_choice`, provider
routing, transforms, and server tools.

For OpenRouter Fusion:

```bash
karl models fusion
karl models fusion fusion-required --required
karl models fusion research \
  --panel "~anthropic/claude-opus-latest,~openai/gpt-latest,~google/gemini-pro-latest" \
  --judge "~openai/gpt-latest"
```

Then run it like any other model:

```bash
karl run --model fusion "compare the strongest arguments on both sides"
karl run --no-tools --model fusion-required "compare the strongest arguments on both sides"
```

When `tool_choice` is `required`, OpenRouter guarantees that some available
tool is called. Use `--no-tools` or a no-tools stack when you need that tool to
be Fusion rather than one of Karl's local tools.

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
