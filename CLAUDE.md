# Karl

AI agent CLI with Agent Skills and Config Stacks.

## Config Stacks

Named configurations bundling model, temperature, timeout, token limits, and skills.

### Using Stacks

```bash
# Run with a config stack
karl as trivia-expert "circumference of earth in miles"
karl as codex52-architect "review spec and create implementation plan"

# List available stacks
karl stacks list

# Create a new stack
karl stacks create my-stack --model smart --skill code-review
```

### Stack Locations
- Global: `~/.config/karl/stacks/<name>.json`
- Project: `./.karl/stacks/<name>.json`
- Inline: `karl.json` → `{ "stacks": { ... } }`

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

Karl supports the [Agent Skills](https://agentskills.io) open standard.

### Using Skills

```bash
# List available skills
karl skills list

# Use a skill
karl --skill security-review "analyze this codebase"
karl --skill code-review "review auth.go"
karl --skill documentation "document the API"
```

### Skill Locations
- Global: `~/.config/karl/skills/`
- Project: `./.karl/skills/`

### Built-in Example Skills
- `security-review` - Security vulnerability analysis
- `code-review` - Code quality assessment
- `documentation` - Technical documentation
