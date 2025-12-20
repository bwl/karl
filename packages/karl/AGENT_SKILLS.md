# Agent Skills Implementation in Karl

Karl now supports the [Agent Skills](https://agentskills.io) open standard for extending AI agent capabilities with specialized knowledge and workflows.

## What are Agent Skills?

Agent Skills are folders containing instructions, scripts, and resources that agents can discover and use to perform tasks more accurately and efficiently. Skills provide:

- **Domain expertise**: Specialized knowledge packaged as reusable instructions
- **Consistent workflows**: Turn multi-step tasks into repeatable processes
- **Portable capabilities**: Use the same skill across different agent products
- **Version-controlled knowledge**: Track and manage expertise like code

## Using Skills

### Activate a Skill

```bash
karl --skill security-review "analyze this codebase for vulnerabilities"
karl --skill code-review "review the auth.go file"
karl --skill documentation "document the API endpoints in api.go"
```

### List Available Skills

```bash
# List all skills
karl skills list

# Verbose listing with descriptions
karl skills list --verbose
```

### Show Skill Details

```bash
karl skills show security-review
```

### Create a New Skill

```bash
# Create with auto-generated description
karl skills create my-skill

# Create with custom description
karl skills create data-analysis --description "Analyze datasets and generate insights"

# Create at specific path
karl skills create custom-workflow --path ./skills/custom-workflow
```

### Validate a Skill

```bash
karl skills validate ./path/to/skill
```

## Skill Locations

Karl looks for skills in these directories (in order):

1. `~/.config/karl/skills/` - Global skills
2. `./.karl/skills/` - Project-specific skills

## Skill Structure

A skill is a directory containing at minimum a `SKILL.md` file:

```
my-skill/
├── SKILL.md           # Required: Skill definition with YAML frontmatter
├── README.md          # Optional: Human-readable documentation
├── scripts/           # Optional: Executable scripts
├── references/        # Optional: Additional documentation
└── assets/           # Optional: Templates, images, etc.
```

### SKILL.md Format

```yaml
---
name: my-skill
description: What this skill does and when to use it
license: Apache-2.0
metadata:
  author: your-name
  version: "1.0"
allowed-tools: read write bash edit
---

# My Skill

You are a specialized assistant focused on [skill domain].

## Instructions

[Detailed instructions for the agent...]

## Examples

[Example inputs and outputs...]
```

## Example Skills

Karl includes several example skills:

### Security Review (`security-review`)
Comprehensive security analysis covering:
- Code vulnerability scanning
- Configuration security review
- Dependency analysis
- Security best practices validation

```bash
karl --skill security-review "analyze the authentication system"
```

### Code Review (`code-review`)
Thorough code quality assessment including:
- Code quality and maintainability
- Performance optimization suggestions
- Best practices compliance
- Testing recommendations

```bash
karl --skill code-review "review the changes in the last commit"
```

### Documentation (`documentation`)
Technical documentation creation for:
- API documentation
- User guides and tutorials
- README files
- Developer documentation

```bash
karl --skill documentation "create API docs for the user service"
```

## Creating Custom Skills

### 1. Generate a Skill Template

```bash
karl skills create my-custom-skill --description "My specialized workflow"
```

This creates:
```
my-custom-skill/
├── SKILL.md          # Main skill definition
├── README.md         # Documentation
├── scripts/          # Script directory
├── references/       # Reference docs directory
└── assets/          # Assets directory
```

### 2. Edit the Skill Definition

Edit `SKILL.md` to define your skill's behavior:

```yaml
---
name: my-custom-skill
description: Handles specialized workflow X for domain Y
license: Apache-2.0
metadata:
  author: $(whoami)
  version: "1.0"
  category: custom
allowed-tools: read write bash
---

# My Custom Skill

You are an expert in [domain] specializing in [specific area].

## Core Capabilities
- [List main capabilities]
- [Define expertise areas]

## Workflow
1. [Step 1 description]
2. [Step 2 description]
3. [Step 3 description]

## Best Practices
- [Important guidelines]
- [Quality standards]

## Examples

### Example 1: Basic Usage
**Input:** [Sample input]
**Process:** [Steps taken]
**Output:** [Expected result]
```

### 3. Test Your Skill

```bash
# Validate the skill
karl skills validate ./my-custom-skill

# Test the skill
karl --skill my-custom-skill "test task for my skill"
```

### 4. Add Scripts (Optional)

Add executable scripts to the `scripts/` directory:

```bash
#!/bin/bash
# scripts/analyze.sh
echo "Running custom analysis..."
# Your script logic here
```

The agent can execute these scripts when needed.

### 5. Add References (Optional)

Create detailed reference documentation in `references/`:

```markdown
# references/REFERENCE.md

## Detailed Technical Reference

[Comprehensive technical details...]

## Troubleshooting

[Common issues and solutions...]
```

## Advanced Features

### Skill-Specific Tools

Use the `allowed-tools` field to pre-approve specific tools:

```yaml
allowed-tools: read bash edit Bash(git:*) Bash(curl:*)
```

### Progressive Disclosure

Structure skills for efficient context usage:
- **Metadata** (~100 tokens): Name and description loaded at startup
- **Instructions** (<5000 tokens): Main skill content loaded when activated
- **Resources**: Additional files loaded on demand

### Project-Specific Skills

Place skills in `./.karl/skills/` for project-specific workflows:

```
my-project/
├── .karl/
│   └── skills/
│       ├── deploy/
│       │   └── SKILL.md
│       └── test/
│           └── SKILL.md
├── src/
└── README.md
```

## Best Practices

### Skill Design
- **Clear descriptions**: Make it easy for agents to choose the right skill
- **Focused expertise**: One skill per domain or workflow
- **Actionable instructions**: Provide specific, executable guidance
- **Example-driven**: Include concrete examples of inputs and outputs

### File Organization
- Keep main `SKILL.md` under 500 lines
- Move detailed reference material to separate files
- Use relative paths for file references
- Maintain shallow directory structures

### Maintenance
- Version your skills alongside your code
- Test skills regularly with actual use cases
- Update examples to stay current
- Document changes in the skill's README

## Integration with Karl

Skills integrate seamlessly with Karl's existing features:

- **Volley Mode**: Use skills with parallel task execution
- **Context Loading**: Skills work with project context files
- **Tool System**: Skills can leverage all of Karl's tools
- **Hooks**: Skills can trigger custom hooks for automation

## Contributing Skills

To contribute skills to the Karl ecosystem:

1. Create well-documented skills following the standard
2. Test skills thoroughly with real-world scenarios
3. Submit skills to the community repository
4. Share skills with clear licensing information

## Migration from Other Systems

If you have existing agent instructions or workflows:

1. Create a new skill with `karl skills create`
2. Copy your instructions to the `SKILL.md` content section
3. Add appropriate frontmatter metadata
4. Test and validate the migrated skill
5. Gradually enhance with Agent Skills features

Skills make your AI workflows portable, version-controlled, and shareable across the growing Agent Skills ecosystem!