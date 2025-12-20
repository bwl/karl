# Karl

AI agent CLI with Agent Skills and Config Stacks.

## Quick Start

```bash
karl run "your task"              # Run with default stack
karl review "check auth.ts"       # Run with 'review' stack (if exists)
karl quickly "2+2"                # Creates stack if missing
```

## Commands

```bash
karl run <task>           # Run task using 'default' stack
karl init                 # First-time setup wizard
karl providers            # Manage providers (add, login, logout)
karl models               # Manage models (add, remove, list)
karl stacks               # Manage config stacks
karl skills               # Manage agent skills
```

## Config Stacks

Named configurations bundling model, skills, and context. Stacks become verbs.

```bash
karl stacks list                 # List available stacks
karl stacks create review        # Create a new stack
karl stacks edit default         # Edit the default stack
karl review "check auth.ts"      # Use 'review' stack as a verb
```

### Stack Locations
- Global: `~/.config/karl/stacks/<name>.json`
- Project: `./.karl/stacks/<name>.json`

### Stack Schema
```json
{
  "model": "haiku",
  "skill": "code-review",
  "context": "You are an expert..."
}
```

## Models & Providers

```bash
karl providers list              # Show configured providers
karl providers add               # Add a new provider
karl providers login             # OAuth login

karl models list                 # Show configured models
karl models add                  # Add a new model
karl models default haiku        # Set default model
```

## Agent Skills

Karl supports the [Agent Skills](https://agentskills.io) open standard.

```bash
karl skills list                 # List available skills
karl run --skill security-review "analyze codebase"
```

### Skill Locations
- Global: `~/.config/karl/skills/`
- Project: `./.karl/skills/`

## Development

Always use `bun` for package management and running scripts:

```bash
bun install              # Install dependencies
bun run build            # Build the CLI
bun tsc --noEmit         # Type check
```
