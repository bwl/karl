# Cliffy

AI agent CLI with Agent Skills and Config Stacks.

## Config Stacks

Named configurations bundling model, temperature, timeout, token limits, and skills.

### Using Stacks

```bash
# Run with a config stack
cliffy as trivia-expert "circumference of earth in miles"
cliffy as codex52-architect "review spec and create implementation plan"

# List available stacks
cliffy stacks list

# Create a new stack
cliffy stacks create my-stack --model smart --skill code-review
```

### Stack Locations
- Global: `~/.config/cliffy/stacks/<name>.json`
- Project: `./.cliffy/stacks/<name>.json`
- Inline: `cliffy.json` → `{ "stacks": { ... } }`

### Stack Schema
```json
{
  "extends": "parent-stack",
  "model": "smart",
  "temperature": 0.7,
  "timeout": 300000,
  "maxTokens": 4096,
  "skill": "code-review",
  "context": "You are an expert...",
  "unrestricted": false
}
```

## Agent Skills

Cliffy supports the [Agent Skills](https://agentskills.io) open standard.

### Using Skills

```bash
# List available skills
cliffy skills list

# Use a skill
cliffy --skill security-review "analyze this codebase"
cliffy --skill code-review "review auth.go"
cliffy --skill documentation "document the API"
```

### Skill Locations
- Global: `~/.config/cliffy/skills/`
- Project: `./.cliffy/skills/`

### Built-in Example Skills
- `security-review` - Security vulnerability analysis
- `code-review` - Code quality assessment
- `documentation` - Technical documentation
