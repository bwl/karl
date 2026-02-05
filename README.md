# Karl

Fast, one-shot LLM queries for your terminal.

## Install

```bash
brew tap bwl/ettio
brew install karl
karl init
```

## Usage

```bash
karl run "your question or task"
karl run "analyze auth.go for security issues"
```

### Pipelines

```bash
cat error.log | karl run "what went wrong?"
git diff | karl run "write a commit message"
```

### Parallel Tasks

```bash
karl run "analyze auth.go" "analyze db.go" "analyze api.go"
```

## Config Stacks

Named configurations that become verbs:

```bash
karl stacks create review         # Create a stack
karl review "check auth.ts"       # Use it as a command
```

## Commands

```bash
karl run <task>       # Run a task (default stack)
karl init             # First-time setup
karl providers        # Manage LLM providers
karl models           # Manage models
karl stacks           # Manage config stacks
karl skills           # Manage agent skills
```

## Documentation

- [CLI Reference](docs/cli-reference.md)
- [Configuration](docs/configuration.md)
- [Tools](docs/tools.md)
- [TUI](docs/tui.md)
- [Volley Mode](docs/volley-mode.md)
- [Architecture](docs/architecture.md)
- [Agent Skills](packages/karl/AGENT_SKILLS.md)

## Development

```bash
bun install
bun run build
```

## License

MIT
