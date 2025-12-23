# Developer Experience

CLI commands, flags, help text, error messages, and documentation.

---

## CLI Structure

```
karl [command|stack-name] [args...] [flags...]

Built-in Commands:
  run, init, providers, models, stacks, skills, info

Stack-as-Verb:
  karl review "task"  ->  karl run --stack review "task"
```

---

## Help Text

```
karl run <task>
karl <command> <task>       (stack as verb)

Built-in Commands:
  run <task>                Run a single task
  init                      First-time setup wizard
  providers                 Manage providers
  models                    Manage models
  stacks                    Manage config stacks
  skills                    Manage agent skills
  info                      Show system info
  history                   Show run history
  previous                  Print last response

Your Commands (stacks as verbs):
  karl review <task>  opus::anthropic/claude-opus-4
  karl commit <task>  haiku::anthropic/claude-haiku-3

Flags (use with 'run'):
  --model, -m          Model alias or ID
  --verbose, -v        Stream thoughts and tools
  --json, -j           JSON output
  --skill              Load a skill by name
  --timeout            Per-task timeout
  --parent             Parent run id or reference
  --tag                Tag the run (repeatable)
  --no-history         Disable history logging
```

---

## Flag Reference

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--model`, `-m` | string | - | Model alias or ID |
| `--verbose`, `-v` | boolean | false | Stream thoughts/tools |
| `--json`, `-j` | boolean | false | JSON output |
| `--stats` | boolean | false | Print summary |
| `--timeout` | duration | - | Per-task timeout |
| `--skill` | string | - | Skill name |
| `--no-tools` | boolean | false | Disable tools |
| `--unrestricted` | boolean | false | Allow writes outside cwd |
| `--context` | string | - | Extra system prompt |
| `--context-file` | path | - | Context file |
| `--parent` | string | - | Parent run id or reference |
| `--tag` | string | - | Tag the run (repeatable) |
| `--no-history` | boolean | false | Disable history logging |
| `--dry-run` | boolean | false | Show config only |

---

## Error Messages

### Configuration Errors

```
Setup incomplete. Run `karl init` to configure a provider.

No credentials found for provider: anthropic
Set the appropriate API key environment variable.
```

### Command Errors

```
Unknown flag: --invalid

Missing value for --model

Multiple tasks provided. Karl accepts a single task per run.
```

### Resource Errors

```
Model "unknown" not found.

Available models:
  - sonnet
  - opus
  - haiku
```

---

## Output Formatting

### Progress Indicator (Spinner)

```
    ○
   /|\   🎾
   / \

  karl is on it... (3.4s)

  ▸ read_file auth.ts
  ✓ grep "password"
```

### Verbose Mode

```
● karl is on it...

  Reading src/auth.ts
  ↳ Found in ./src/auth.ts (47 KB)

▸ read_file
  ✓ read_file done

  Analyzing code structure...

── done in 3.4s ──
```

### JSON Output

```json
{
  "results": [{
    "task": "analyze auth.ts",
    "status": "success",
    "result": "Analysis complete...",
    "tokens": { "input": 1234, "output": 567 },
    "duration_ms": 3421,
    "tools_used": ["read_file", "grep"]
  }],
  "summary": {
    "total": 1,
    "succeeded": 1,
    "failed": 0
  }
}
```

---

## Interactive Prompts

### Yes/No Prompts

```
Create "review" as a new command (stack)? [Y/n]
```

Accepts: `y`, `yes`, `Y`, or empty (default yes)

### Selection Prompts

```
Available providers:
  1. anthropic - API Key
  2. claude-pro-max - OAuth
  3. openrouter - API Key

Select provider [1]:
```

Accepts number or name directly.

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Error (invalid config, task failed, etc.) |

---

## Color Scheme

| Color | Usage |
|-------|-------|
| Green | Success (checkmarks) |
| Red | Errors |
| Cyan | Tool names (verbose) |
| Dim | Thinking text, timestamps |
| Bold | Headers |

Colors disabled if `NO_COLOR` env var is set.

---

## Verbosity Levels

1. **Normal** (default): Spinner with minimal output
2. **Verbose** (`-v`): Streaming thoughts and tool calls
3. **JSON** (`-j`): Structured output for scripting

---

## Dry Run Mode

```
Dry Run Configuration

Provider:     anthropic
Model:        claude-sonnet-4
Model Alias:  sonnet
Auth:         API Key
Skill:        code-review
Stack:        review
Tools:        read, write, edit, bash
Tasks:        1
  - "check auth.ts"
```

---

## Error Handling Patterns

All errors:
1. Print to stderr
2. Set `process.exitCode = 1`
3. Exit gracefully (no stack traces for user errors)

```typescript
export function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return JSON.stringify(error);
}
```
