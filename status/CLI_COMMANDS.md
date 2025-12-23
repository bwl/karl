# CLI Commands

Interactive wizard commands in `packages/karl/src/commands/`.

---

## Command Files

| Command | File | Lines | Description |
|---------|------|-------|-------------|
| `init` | `commands/init.ts` | 223 | First-run setup wizard |
| `providers` | `commands/providers.ts` | 544 | Provider management |
| `models` | `commands/models.ts` | 589 | Model management |
| `stacks` | `commands/stacks.ts` | 365 | Stack management |
| `skills` | `commands/skills.ts` | 412 | Skills management |
| `info` | `commands/info.ts` | 217 | System information |
| `history` | `commands/history.ts` | 241 | Run history listing/show |
| `previous` | `commands/previous.ts` | 33 | Last response output |
| `run` | `cli.ts` | inline | Execute tasks |

---

## karl init

**Purpose:** First-run setup wizard.

**Creates:**
1. Provider in `~/.config/karl/providers/`
2. Model in `~/.config/karl/models/`
3. Default stack in `~/.config/karl/stacks/default.json`

**Flow:**
```
Available providers:
  1. anthropic - API Key
  2. claude-pro-max - OAuth
  3. openrouter - API Key
  4. openai - API Key

Select provider [1]: 1

Available models:
  1. claude-sonnet-4-20250514
  2. claude-opus-4-20250514

Select model [1]: 1
Model alias [sonnet]:

Setup complete!
```

---

## karl providers

### Subcommands

| Command | Aliases | Description |
|---------|---------|-------------|
| `list` | `ls` | List providers |
| `show` | `info` | Show provider details |
| `add` | `new`, `create` | Add provider (interactive) |
| `remove` | `rm`, `delete` | Remove provider |
| `login` | - | OAuth login |
| `logout` | - | OAuth logout |

### Output Format

```
Found 3 providers:

  anthropic           $ANTHROPIC_API_KEY  ready
  claude-pro-max      OAuth               not authenticated
  openrouter          $OPENROUTER_API_KEY ready
```

---

## karl models

### Subcommands

| Command | Aliases | Flags | Description |
|---------|---------|-------|-------------|
| `list` | `ls` | - | List models |
| `show` | `info` | - | Show model details |
| `add` | `new`, `create` | `--provider`, `--model`, `--default` | Add model |
| `remove` | `rm`, `delete` | - | Remove model |
| `default` | `set-default` | - | Set default model |
| `refresh` | `update` | - | Update OpenRouter metadata |

### Output Format

```
Found 3 models:

  sonnet              anthropic/claude-sonnet-4-20250514
  opus                anthropic/claude-opus-4-20250514
  haiku               anthropic/claude-haiku-3-5-20241022

Default: sonnet
```

---

## karl stacks

### Subcommands

| Command | Aliases | Flags | Description |
|---------|---------|-------|-------------|
| `list` | `ls` | `--verbose` | List stacks |
| `show` | `info` | - | Show stack details |
| `create` | `new` | `--model`, `--skill`, `--global` | Create stack |
| `edit` | - | - | Edit stack ($EDITOR) |
| `remove` | `rm`, `delete` | - | Remove stack |

### Stack Schema

```json
{
  "model": "opus",
  "skill": "code-review",
  "context": "Be thorough but concise",
  "extends": "default",
  "timeout": "30s"
}
```

---

## karl skills

### Subcommands

| Command | Aliases | Flags | Description |
|---------|---------|-------|-------------|
| `list` | `ls` | `--verbose` | List skills |
| `show` | `info` | - | Show skill details |
| `create` | `new` | `--global`, `--project`, `--description` | Create skill |
| `validate` | `check` | - | Validate skill |

### Skill Structure

```
skill-name/
  SKILL.md           # Main definition
  README.md          # Documentation
  scripts/           # Executable scripts
  references/        # Additional docs
  assets/           # Static resources
```

---

## karl run

### Flags

| Flag | Aliases | Type | Description |
|------|---------|------|-------------|
| `--model` | `-m` | string | Model alias or ID |
| `--verbose` | `-v` | boolean | Stream thoughts and tools |
| `--json` | `-j` | boolean | JSON output |
| `--stats` | - | boolean | Print summary stats |
| `--timeout` | - | duration | Per-task timeout |
| `--skill` | - | string | Load skill by name |
| `--no-tools` | - | boolean | Disable tool use |
| `--unrestricted` | - | boolean | Allow writes outside cwd |
| `--context` | - | string | Extra system prompt |
| `--context-file` | - | path | Context file (use `-` for stdin) |
| `--dry-run` | - | boolean | Show config only |
| `--stack` | - | string | Stack name |
| `--parent` | - | string | Parent run id or reference (`@last`, `@-2`) |
| `--tag` | - | string | Tag the run (repeatable) |
| `--no-history` | - | boolean | Disable history logging |

### Usage Examples

```bash
karl run "fix the bug"
karl run --model opus "explain this code"
karl run --skill code-review "check auth.ts"
```

---

## Stack-as-Verb Pattern

Unknown commands become stack lookups:

```bash
karl review "check auth.ts"
# Equivalent to:
karl run --stack review "check auth.ts"
```

If stack doesn't exist, offers interactive creation wizard.

---

## karl info

**Human-readable:**
```
Karl v0.1.0

Configuration:
  Global:  ~/.config/karl/karl.json
  Project: ./.karl.json (not found)

Models:
  Default: sonnet
  Configured: sonnet, opus, haiku

Summary:
  Models: 3  Stacks: 5  Skills: 3
```

**JSON output** (`--json`):
```json
{
  "version": "0.1.0",
  "models": { "default": "sonnet", "configured": ["sonnet", "opus"] },
  "counts": { "skills": 3, "stacks": 5, "hooks": 0 }
}
```

---

## karl history

List or show previous runs recorded in history.

Examples:
```bash
karl history
karl history --limit 10
karl history --tag auth
karl history ace_20240115_143218_ab12
karl history ace_20240115_143218_ab12 --response
```

---

## karl previous

Print the last response text from history.

Examples:
```bash
karl previous
karl previous --id
karl previous --json
```

---

## Command Registration Pattern

All modules export `handle<Command>Command(args: string[])`:

```typescript
export async function handleModelsCommand(args: string[]) {
  const [command, ...rest] = args;
  switch (command) {
    case 'list':
    case 'ls':
      await listModels();
      break;
    // ...
  }
}
```
