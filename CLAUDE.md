# Cliffy

AI agent CLI with Agent Skills support.

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
