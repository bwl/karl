# Karl Skill Ecosystem

## 1. Skill Composition

Skills can work together through chaining, extension, and inheritance patterns.

### Chaining Skills

Skills can be chained together using the `chainable: true` metadata flag. When a skill is chainable, its output becomes context for the next skill.

```yaml
---
name: discover
description: Gather facts about the codebase
license: Apache-2.0
metadata:
  author: karl-training
  version: "1.0"
  chainable: true
---
```

Example chain:
```bash
# Discovery → Architecture pipeline
karl run --skill discover "Add rate limiting" | \
karl run --skill architect --context-file - "Design solution"
```

### Skill Extension

Skills can extend other skills by including their output:

```markdown
---
name: architect-plus
description: Enhanced architecture with security review
license: Apache-2.0
metadata:
  extends: architect
  version: "1.1"
---

# Architect Plus

First run the base architect skill, then add security considerations:

1. Generate base architecture
2. Add security analysis section
3. Include threat model
```

### Inheritance Pattern

Create skill families with shared behavior:

```
skills/
├── base/
│   └── SKILL.md          # Base skill definition
├── web/
│   └── SKILL.md          # Extends base, adds web-specifics
└── api/
    └── SKILL.md          # Extends web, adds API-specifics
```

## 2. Skill Variables

Parameterize skills with variables and defaults.

### Variable Definition

```yaml
---
name: codemap
description: Extract code structure
license: Apache-2.0
metadata:
  author: karl-training
  version: "1.0"
  variables:
    depth:
      description: "How many levels deep to analyze"
      type: number
      default: 3
      min: 1
      max: 10
    include_private:
      description: "Include private members"
      type: boolean
      default: false
---
```

### Using Variables

```bash
# Use defaults
karl run --skill codemap "Analyze this code"

# Override variables
karl run --skill codemap \
  --skill-var depth=5 \
  --skill-var include_private=true \
  "Analyze deeply"
```

### Variable Types

| Type | Example | Validation |
|------|---------|------------|
| string | `"src/"` | Any text |
| number | `42` | Numeric |
| boolean | `true` | true/false |
| enum | `"fast"` | ["fast","slow"] |
| path | `"./config"` | Valid path |

## 3. Skill Testing

Validate skills work correctly with test patterns.

### Test Structure

```
skills/
└── my-skill/
    ├── SKILL.md          # Skill definition
    ├── tests/            # Test directory
    │   ├── basic/        # Basic functionality
    │   │   ├── input.md  # Test input
    │   │   └── expected.md # Expected output
    │   └── edge-cases/   # Edge case tests
    └── test.sh           # Test runner
```

### Test Example

```bash
#!/bin/bash
# test.sh - Skill test runner

# Basic test
echo "Running basic test..."
output=$(karl run --skill my-skill "$(cat tests/basic/input.md)")
diff tests/basic/expected.md <(echo "$output") || exit 1

# Variable test
echo "Running variable test..."
output=$(karl run --skill my-skill \
  --skill-var depth=2 \
  "$(cat tests/variables/input.md)")
diff tests/variables/expected.md <(echo "$output") || exit 1

echo "All tests passed!"
```

### Test Input Example

```markdown
# tests/basic/input.md
---
task: "Analyze this simple function"
context: |
  function add(a, b) {
    return a + b;
  }
---
```

### Expected Output

```markdown
# tests/basic/expected.md
## Analysis
- Function: add(a, b)
- Returns: sum of a and b
- Complexity: O(1)
```

## 4. Skill Discovery

Find and share skills effectively.

### Local Discovery

```bash
# List available skills
karl skills list

# Show skill details
karl skills show architect

# Search skills
karl skills list --search "code"
```

### Skill Metadata for Discovery

```yaml
---
name: security-review
description: Analyze code for security issues
license: MIT
metadata:
  author: security-team
  version: "2.1"
  tags:
    - security
    - audit
    - review
  compatibility:
    - karl: ">=1.0"
    - models: ["opus", "sonnet"]
  examples:
    - "karl run --skill security-review 'Check this PR'"
---
```

### Skill Sharing

Share skills via:
1. **Git repositories**: Clone skill repos
2. **Skill registries**: Publish to community registries
3. **Direct files**: Copy SKILL.md files

```bash
# Install from git
git clone https://github.com/org/security-skills.git ~/.config/karl/skills/security

# Install from registry
karl skills install security-review@2.1

# Install from file
cp ~/Downloads/cool-skill/SKILL.md ~/.config/karl/skills/cool-skill/
```

## 5. Skill Versioning

Manage compatibility and updates.

### Semantic Versioning

Use `MAJOR.MINOR.PATCH` versioning:

```yaml
metadata:
  version: "2.1.0"  # MAJOR.MINOR.PATCH
```

- **PATCH**: Backward-compatible bug fixes
- **MINOR**: Backward-compatible new features
- **MAJOR**: Breaking changes

### Compatibility Matrix

```yaml
metadata:
  compatibility:
    karl: ">=1.0 <2.0"  # Karl version range
    models: ["opus", "sonnet"]  # Recommended models
    skills:  # Skill dependencies
      discover: ">=1.0"
```

### Version Constraints

| Operator | Meaning |
|----------|---------|
| `>` | Greater than |
| `>=` | Greater than or equal |
| `<` | Less than |
| `<=` | Less than or equal |
| `=` | Exact version |
| `~` | Patch updates (1.2.3 → 1.2.4) |
| `^` | Minor updates (1.2.3 → 1.3.0) |

### Update Strategy

```bash
# Check for updates
karl skills outdated

# Update specific skill
karl skills update security-review

# Update all skills
karl skills update --all

# Pin to specific version
karl skills install security-review@1.5.2
```

## Best Practices

1. **Document variables**: Always specify types and defaults
2. **Test edge cases**: Include empty inputs, large files
3. **Version carefully**: Follow semantic versioning
4. **Tag appropriately**: Use meaningful tags for discovery
5. **Chain responsibly**: Only chain when output is valid context

## Example: Complete Skill with All Features

```yaml
---
name: full-analysis
description: Complete code analysis with multiple phases
license: Apache-2.0
metadata:
  author: code-quality-team
  version: "3.2.1"
  chainable: true
  extends: discover
  variables:
    depth:
      type: number
      default: 3
      min: 1
      max: 10
    include_tests:
      type: boolean
      default: false
  tags:
    - analysis
    - quality
    - review
  compatibility:
    karl: ">=1.2"
    models: ["opus", "sonnet", "devstral"]
  examples:
    - "karl run --skill full-analysis 'Analyze this PR'"
    - "karl run --skill full-analysis --skill-var depth=5 'Deep analysis'"
---

# Full Analysis Skill

Multi-phase analysis:
1. Discovery phase (inherited)
2. Architecture review
3. Security scan
4. Performance analysis

## Usage

```bash
# Basic usage
karl run --skill full-analysis "Check this code"

# With variables
karl run --skill full-analysis \
  --skill-var depth=4 \
  --skill-var include_tests=true \
  "Full analysis with tests"
```
```
