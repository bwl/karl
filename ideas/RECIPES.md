# Karl Recipes

**Recipes are reusable workflows that combine Karl's capabilities into named, parameterized commands.**

Think of recipes as shell aliases on steroids: they capture common development workflows, can accept parameters, chain together, and share context intelligently.

## Table of Contents

- [Philosophy](#philosophy)
- [Recipes vs Skills](#recipes-vs-skills)
- [Recipe Format](#recipe-format)
- [Recipe Locations](#recipe-locations)
- [Using Recipes](#using-recipes)
- [Recipe Parameters](#recipe-parameters)
- [Recipe Chaining](#recipe-chaining)
- [Recipe Testing](#recipe-testing)
- [Community Sharing](#community-sharing)
- [Integration with Build Tools](#integration-with-build-tools)
- [20 Essential Recipes](#20-essential-recipes)
- [Advanced Patterns](#advanced-patterns)

---

## Philosophy

**Serve-and-Volley for Workflows**

Recipes embody Karl's tennis philosophy:
- **Aces**: One-shot completions for common tasks
- **Volleys**: Parallel execution when recipes can run concurrently
- **No rallies**: Recipes should have clear inputs and outputs, no back-and-forth

Recipes are:
- **Declarative**: Describe what, not how
- **Composable**: Chain and combine freely
- **Contextual**: Inherit project settings
- **Shareable**: Version control and distribute

---

## Recipes vs Skills

Understanding the distinction:

| Aspect | Skills | Recipes |
|--------|--------|---------|
| **Purpose** | Inject domain expertise | Define workflows |
| **Content** | Knowledge, context, guidelines | Steps, commands, prompts |
| **Reusability** | Across all tasks | Specific task patterns |
| **Example** | TypeScript expert knowledge | "Generate PR description" |
| **Location** | `.karl/skills/` | `.karl/recipes/` |
| **Invocation** | `--skill typescript` | `karl recipe:pr-description` |

**Use together**: A recipe can invoke specific skills for enhanced results.

```bash
# Recipe uses skill
karl recipe:code-review --skill rust
```

---

## Recipe Format

Recipes are YAML files with a clear structure:

```yaml
name: recipe-name
description: Brief description of what this recipe does
version: 1.0.0

# Optional metadata
author: username
tags: [git, documentation, review]
model: cliffy  # Default model (can be overridden)
stack: default  # Execution profile

# Input parameters
params:
  - name: file
    description: File to process
    required: true
    type: path
  - name: style
    description: Output style
    default: concise
    type: enum
    values: [concise, detailed, minimal]

# Skills to load
skills: []

# Pre-execution checks
requires:
  - git  # Command must exist
  - .git  # File/directory must exist

# Main execution steps
steps:
  - name: Step description
    command: bash
    input: |
      git diff --cached
    
  - name: Generate description
    command: prompt
    template: |
      Analyze this git diff and create a PR description:
      
      {{step.0.output}}
      
      Style: {{params.style}}
    
  - name: Save output
    command: write
    file: "{{output.file}}"
    content: "{{step.1.output}}"

# Post-processing
output:
  format: markdown  # or json, text, yaml
  file: stdout  # or a file path
  template: |
    # PR Description
    
    {{step.1.output}}
```

### Minimal Recipe

```yaml
name: quick-comment
description: Add comments to code

params:
  - name: file
    required: true

steps:
  - command: prompt
    input: "{{file:file}}"
    template: "Add helpful comments to this code"
```

---

## Recipe Locations

Recipes follow a hierarchy:

```
1. Built-in recipes (shipped with Karl)
   ~/.karl/recipes/builtin/

2. User recipes (your personal collection)
   ~/.karl/recipes/

3. Project recipes (team-shared, version controlled)
   .karl/recipes/

4. Ephemeral (one-off, not saved)
   --recipe-inline
```

### Discovery Order

Karl searches in reverse order (project → user → builtin), allowing overrides:

```bash
# Project recipe overrides builtin
.karl/recipes/code-review.yml  # ← Used
~/.karl/recipes/builtin/code-review.yml  # ← Ignored
```

---

## Using Recipes

### Basic Usage

```bash
# Run a recipe
karl recipe:name

# With parameters
karl recipe:pr-description --file src/main.ts

# Override model
karl recipe:code-review --model opus

# Pipe input
git diff | karl recipe:explain

# Verbose mode
karl recipe:changelog --verbose
```

### List Available Recipes

```bash
# All recipes
karl recipes

# With filters
karl recipes --tag git
karl recipes --author me

# Show recipe details
karl recipe:name --info
```

### Dry Run

```bash
# See what would execute
karl recipe:deploy --dry-run
```

---

## Recipe Parameters

### Parameter Types

```yaml
params:
  # Simple string
  - name: message
    type: string
    required: true
  
  # File path (validates existence)
  - name: input
    type: path
    required: true
  
  # Directory path
  - name: output_dir
    type: dir
    default: ./dist
  
  # Enum/choice
  - name: level
    type: enum
    values: [debug, info, warn, error]
    default: info
  
  # Boolean flag
  - name: verbose
    type: boolean
    default: false
  
  # Number
  - name: limit
    type: number
    default: 10
    min: 1
    max: 100
  
  # Array (comma-separated)
  - name: files
    type: array
    default: []
  
  # JSON object
  - name: config
    type: json
    default: {}
```

### Using Parameters in Steps

```yaml
steps:
  - command: prompt
    template: |
      Process {{params.file}} with {{params.level}} level
      Verbose: {{params.verbose}}
      Files: {{params.files | join(', ')}}
```

### Environment Variables

Parameters can come from environment:

```yaml
params:
  - name: api_key
    env: OPENAI_API_KEY
    required: true
```

---

## Recipe Chaining

### Sequential Chaining

```yaml
name: full-review
description: Complete code review workflow

steps:
  # Step 1: Lint
  - name: lint
    recipe: lint-code
    params:
      file: "{{params.file}}"
  
  # Step 2: Review (uses lint results)
  - name: review
    recipe: code-review
    params:
      file: "{{params.file}}"
      lint_results: "{{step.lint.output}}"
  
  # Step 3: Generate report
  - command: prompt
    template: |
      Create a summary report:
      
      Lint: {{step.lint.output}}
      Review: {{step.review.output}}
```

### Parallel Execution (Volley Mode)

```yaml
name: multi-check
description: Run multiple checks in parallel

steps:
  - parallel: true
    steps:
      - name: lint
        recipe: lint-code
      
      - name: test
        recipe: run-tests
      
      - name: security
        recipe: security-scan
  
  # Aggregate results
  - name: summary
    command: prompt
    template: |
      Summarize these results:
      Lint: {{step.0.lint.output}}
      Tests: {{step.0.test.output}}
      Security: {{step.0.security.output}}
```

### Conditional Steps

```yaml
steps:
  - name: check
    command: bash
    input: git diff --cached --quiet
  
  - name: review
    when: "{{step.check.exit_code}} != 0"
    recipe: code-review
```

---

## Recipe Testing

### Test Definition

```yaml
# .karl/recipes/my-recipe.test.yml
recipe: my-recipe

tests:
  - name: Basic usage
    params:
      file: test/fixtures/sample.ts
    expect:
      exit_code: 0
      output_contains: "// Added comments"
  
  - name: Missing required param
    params: {}
    expect:
      exit_code: 1
      error_contains: "file is required"
  
  - name: Output format
    params:
      file: test/fixtures/sample.ts
    expect:
      output_matches: "^//.*"
      output_format: text
```

### Running Tests

```bash
# Test a recipe
karl test recipe:my-recipe

# Test all recipes
karl test recipes

# CI mode
karl test recipes --ci --coverage
```

---

## Community Sharing

### Recipe Registry

Share recipes with the community:

```bash
# Publish a recipe
karl recipe:publish my-recipe

# Install from registry
karl recipe:install @user/awesome-workflow

# Search registry
karl recipe:search "code review"

# Update installed recipes
karl recipe:update
```

### Recipe Manifest

```yaml
# .karl/recipe-manifest.yml
recipes:
  - name: awesome-workflow
    source: https://github.com/user/karl-recipes
    version: ^1.0.0
  
  - name: team-standards
    source: ./internal/recipes
    local: true
```

### Installing Dependencies

```bash
# Install all recipes from manifest
karl recipe:install

# Lock versions
karl recipe:lock
```

---

## Integration with Build Tools

### npm/package.json

```json
{
  "scripts": {
    "karl:review": "karl recipe:code-review --file",
    "karl:pr": "karl recipe:pr-description",
    "karl:docs": "karl recipe:generate-docs --output docs/",
    "precommit": "karl recipe:pre-commit-check"
  }
}
```

```bash
npm run karl:review -- src/index.ts
```

### Makefile

```makefile
.PHONY: review docs changelog

review:
	karl recipe:code-review --file $(FILE)

docs:
	karl recipe:generate-docs --output docs/

changelog:
	git log $(LAST_TAG)..HEAD | karl recipe:changelog > CHANGELOG.md

pre-commit:
	karl recipe:pre-commit-check
```

### Git Hooks

```bash
# .git/hooks/pre-commit
#!/bin/bash
karl recipe:pre-commit-check || exit 1
```

### GitHub Actions

```yaml
# .github/workflows/karl.yml
name: Karl Recipes

on: [pull_request]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: oven-sh/setup-bun@v1
      - run: bun install -g karl
      - run: karl recipe:pr-review --pr ${{ github.event.pull_request.number }}
```

### VSCode Tasks

```json
// .vscode/tasks.json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Karl: Code Review",
      "type": "shell",
      "command": "karl recipe:code-review --file ${file}"
    },
    {
      "label": "Karl: Explain",
      "type": "shell",
      "command": "karl recipe:explain --file ${file}"
    }
  ]
}
```

---

## 20 Essential Recipes

### 1. PR Description Generator

```yaml
name: pr-description
description: Generate PR description from git diff
tags: [git, pr, documentation]

params:
  - name: base
    description: Base branch
    default: main
  - name: style
    type: enum
    values: [concise, detailed]
    default: concise

steps:
  - name: Get diff
    command: bash
    input: git diff {{params.base}}...HEAD
  
  - name: Get commit messages
    command: bash
    input: git log {{params.base}}...HEAD --pretty=format:"%s"
  
  - name: Generate description
    command: prompt
    template: |
      Create a {{params.style}} PR description from this diff and commits.
      
      Commits:
      {{step.1.output}}
      
      Diff:
      {{step.0.output}}
      
      Format as:
      # Title
      ## Changes
      ## Testing
      ## Notes
```

**Usage:**
```bash
karl recipe:pr-description > pr.md
karl recipe:pr-description --style detailed --base develop
```

---

### 2. Code Review

```yaml
name: code-review
description: Comprehensive code review of changes
tags: [review, quality]

params:
  - name: file
    type: path
    required: false
  - name: staged
    type: boolean
    default: false

steps:
  - name: Get changes
    command: bash
    input: |
      {{#if params.file}}
      git diff {{params.file}}
      {{else if params.staged}}
      git diff --cached
      {{else}}
      git diff
      {{/if}}
  
  - name: Review
    command: prompt
    model: opus  # Use best model for reviews
    template: |
      Review this code for:
      - Bugs and logic errors
      - Performance issues
      - Security vulnerabilities
      - Best practices
      - Code style and readability
      
      {{step.0.output}}
      
      Provide specific, actionable feedback.
```

**Usage:**
```bash
karl recipe:code-review
karl recipe:code-review --file src/auth.ts
karl recipe:code-review --staged
```

---

### 3. Changelog Generator

```yaml
name: changelog
description: Generate changelog from git history
tags: [git, documentation, release]

params:
  - name: from
    description: Start tag/commit
    required: true
  - name: to
    description: End tag/commit
    default: HEAD
  - name: format
    type: enum
    values: [keepachangelog, simple, detailed]
    default: keepachangelog

steps:
  - name: Get commits
    command: bash
    input: git log {{params.from}}..{{params.to}} --pretty=format:"%h %s (%an)"
  
  - name: Generate changelog
    command: prompt
    template: |
      Generate a changelog in {{params.format}} format from these commits:
      
      {{step.0.output}}
      
      Group by: Added, Changed, Deprecated, Removed, Fixed, Security
```

**Usage:**
```bash
git tag | tail -1 | xargs -I {} karl recipe:changelog --from {}
karl recipe:changelog --from v1.0.0 --to v2.0.0
```

---

### 4. Documentation Generator

```yaml
name: generate-docs
description: Generate documentation from code
tags: [documentation]

params:
  - name: input
    type: path
    required: true
  - name: output
    type: path
    required: false
  - name: format
    type: enum
    values: [markdown, jsdoc, readme]
    default: markdown

steps:
  - name: Read code
    command: read
    file: "{{params.input}}"
  
  - name: Generate docs
    command: prompt
    template: |
      Generate {{params.format}} documentation for this code.
      Include examples, parameters, return values.
      
      {{step.0.output}}
  
  - name: Write output
    when: "{{params.output}}"
    command: write
    file: "{{params.output}}"
    content: "{{step.1.output}}"
```

**Usage:**
```bash
karl recipe:generate-docs --input src/api.ts --output docs/api.md
karl recipe:generate-docs --input lib/ --format jsdoc
```

---

### 5. Commit Message Generator

```yaml
name: commit-message
description: Generate conventional commit message
tags: [git]

params:
  - name: type
    type: enum
    values: [feat, fix, docs, style, refactor, test, chore]
    required: false

steps:
  - name: Get staged changes
    command: bash
    input: git diff --cached
  
  - name: Generate message
    command: prompt
    template: |
      Generate a conventional commit message for these changes.
      {{#if params.type}}Type: {{params.type}}{{/if}}
      
      {{step.0.output}}
      
      Format: <type>(<scope>): <description>
      
      Include body if needed. Keep under 72 chars for subject.
```

**Usage:**
```bash
git add . && karl recipe:commit-message | git commit -F -
karl recipe:commit-message --type feat
```

---

### 6. Explain Code

```yaml
name: explain
description: Explain code in plain English
tags: [learning, documentation]

params:
  - name: file
    type: path
    required: false
  - name: level
    type: enum
    values: [beginner, intermediate, expert]
    default: intermediate

steps:
  - name: Get code
    command: bash
    input: |
      {{#if params.file}}
      cat {{params.file}}
      {{else}}
      cat
      {{/if}}
  
  - name: Explain
    command: prompt
    template: |
      Explain this code for a {{params.level}} developer.
      Break down complex parts, explain patterns used.
      
      {{step.0.output}}
```

**Usage:**
```bash
karl recipe:explain --file src/complex.ts
cat weird.js | karl recipe:explain --level beginner
```

---

### 7. Test Generator

```yaml
name: generate-tests
description: Generate unit tests for code
tags: [testing]

params:
  - name: file
    type: path
    required: true
  - name: framework
    type: enum
    values: [jest, vitest, mocha, pytest, go-test]
    required: true
  - name: coverage
    type: enum
    values: [basic, thorough, edge-cases]
    default: thorough

steps:
  - name: Read source
    command: read
    file: "{{params.file}}"
  
  - name: Generate tests
    command: prompt
    skill: testing
    template: |
      Generate {{params.coverage}} tests using {{params.framework}} for:
      
      {{step.0.output}}
      
      Include: happy path, errors, edge cases, mocks as needed.
```

**Usage:**
```bash
karl recipe:generate-tests --file src/auth.ts --framework jest
karl recipe:generate-tests --file api.py --framework pytest --coverage edge-cases
```

---

### 8. Refactor Suggestion

```yaml
name: refactor
description: Suggest refactoring improvements
tags: [refactoring, quality]

params:
  - name: file
    type: path
    required: true
  - name: focus
    type: enum
    values: [performance, readability, maintainability, all]
    default: all

steps:
  - name: Read code
    command: read
    file: "{{params.file}}"
  
  - name: Analyze
    command: prompt
    model: opus
    template: |
      Analyze this code and suggest refactoring improvements.
      Focus: {{params.focus}}
      
      {{step.0.output}}
      
      For each suggestion:
      1. What to change
      2. Why it's better
      3. Code example
```

**Usage:**
```bash
karl recipe:refactor --file legacy.ts
karl recipe:refactor --file slow.py --focus performance
```

---

### 9. Bug Hunt

```yaml
name: bug-hunt
description: Find potential bugs in code
tags: [quality, debugging]

params:
  - name: file
    type: path
    required: true
  - name: severity
    type: enum
    values: [all, critical, high, medium]
    default: all

steps:
  - name: Read code
    command: read
    file: "{{params.file}}"
  
  - name: Hunt
    command: prompt
    model: opus
    template: |
      Find potential bugs in this code:
      {{step.0.output}}
      
      Look for:
      - Null/undefined issues
      - Race conditions
      - Memory leaks
      - Off-by-one errors
      - Type mismatches
      - Edge cases
      
      Severity filter: {{params.severity}}
      
      For each bug: location, issue, fix, severity.
```

**Usage:**
```bash
karl recipe:bug-hunt --file src/parser.ts
karl recipe:bug-hunt --file app.js --severity critical
```

---

### 10. Dependency Update

```yaml
name: dependency-update
description: Analyze dependency updates and breaking changes
tags: [dependencies, maintenance]

params:
  - name: package
    required: false

steps:
  - name: Get outdated
    command: bash
    input: |
      {{#if params.package}}
      npm outdated {{params.package}} --json
      {{else}}
      npm outdated --json
      {{/if}}
  
  - name: Analyze
    command: prompt
    template: |
      Analyze these outdated dependencies:
      {{step.0.output}}
      
      For each, determine:
      - Breaking changes likely?
      - Update priority (security/features/minor)
      - Migration effort
      - Recommended action
```

**Usage:**
```bash
karl recipe:dependency-update
karl recipe:dependency-update --package react
```

---

### 11. API Documentation

```yaml
name: api-docs
description: Generate API endpoint documentation
tags: [api, documentation]

params:
  - name: file
    type: path
    required: true
  - name: format
    type: enum
    values: [openapi, markdown, postman]
    default: markdown

steps:
  - name: Read routes
    command: read
    file: "{{params.file}}"
  
  - name: Generate docs
    command: prompt
    template: |
      Generate {{params.format}} documentation for these API routes:
      {{step.0.output}}
      
      Include: endpoint, method, params, body, response, errors, examples.
```

**Usage:**
```bash
karl recipe:api-docs --file routes/api.ts
karl recipe:api-docs --file server.py --format openapi
```

---

### 12. Security Audit

```yaml
name: security-audit
description: Security audit of code
tags: [security, audit]

params:
  - name: file
    type: path
    required: true
  - name: framework
    required: false

steps:
  - name: Read code
    command: read
    file: "{{params.file}}"
  
  - name: Audit
    command: prompt
    skill: security
    model: opus
    template: |
      Security audit this code{{#if params.framework}} ({{params.framework}}){{/if}}:
      {{step.0.output}}
      
      Check for:
      - SQL injection
      - XSS vulnerabilities
      - Authentication issues
      - Authorization bypasses
      - Sensitive data exposure
      - CSRF
      - Cryptography misuse
      
      Rate severity: CRITICAL, HIGH, MEDIUM, LOW, INFO
```

**Usage:**
```bash
karl recipe:security-audit --file auth.ts
karl recipe:security-audit --file app.py --framework flask
```

---

### 13. Code to Diagram

```yaml
name: diagram
description: Generate mermaid diagram from code
tags: [visualization, documentation]

params:
  - name: file
    type: path
    required: true
  - name: type
    type: enum
    values: [flowchart, sequence, class, er]
    default: flowchart

steps:
  - name: Read code
    command: read
    file: "{{params.file}}"
  
  - name: Generate diagram
    command: prompt
    template: |
      Generate a mermaid {{params.type}} diagram for this code:
      {{step.0.output}}
      
      Output only the mermaid syntax, properly formatted.
```

**Usage:**
```bash
karl recipe:diagram --file workflow.ts --type flowchart > diagram.mmd
karl recipe:diagram --file models.py --type class
```

---

### 14. Migration Guide

```yaml
name: migration-guide
description: Generate migration guide for breaking changes
tags: [migration, documentation]

params:
  - name: from_version
    required: true
  - name: to_version
    required: true

steps:
  - name: Get changes
    command: bash
    input: git diff {{params.from_version}}..{{params.to_version}}
  
  - name: Generate guide
    command: prompt
    template: |
      Generate migration guide from {{params.from_version}} to {{params.to_version}}:
      {{step.0.output}}
      
      Include:
      - Breaking changes
      - Deprecated features
      - New features
      - Step-by-step migration
      - Code examples (before/after)
```

**Usage:**
```bash
karl recipe:migration-guide --from_version v1.0.0 --to_version v2.0.0
```

---

### 15. Performance Analysis

```yaml
name: performance-analysis
description: Analyze code performance
tags: [performance, optimization]

params:
  - name: file
    type: path
    required: true
  - name: language
    required: false

steps:
  - name: Read code
    command: read
    file: "{{params.file}}"
  
  - name: Analyze
    command: prompt
    model: opus
    template: |
      Performance analysis{{#if params.language}} ({{params.language}}){{/if}}:
      {{step.0.output}}
      
      Analyze:
      - Time complexity
      - Space complexity
      - Bottlenecks
      - Optimization opportunities
      - Benchmark suggestions
      
      Provide specific improvements with code examples.
```

**Usage:**
```bash
karl recipe:performance-analysis --file slow-query.ts
karl recipe:performance-analysis --file algorithm.py --language python
```

---

### 16. README Generator

```yaml
name: readme
description: Generate README.md from project
tags: [documentation]

params:
  - name: detailed
    type: boolean
    default: false

steps:
  - name: Get project info
    command: bash
    input: |
      echo "=== Package ==="
      cat package.json 2>/dev/null || cat pyproject.toml 2>/dev/null || cat Cargo.toml 2>/dev/null
      echo "=== Files ==="
      find . -maxdepth 2 -type f \( -name "*.ts" -o -name "*.js" -o -name "*.py" \) | head -20
  
  - name: Generate README
    command: prompt
    template: |
      Generate a {{#if params.detailed}}detailed{{else}}concise{{/if}} README.md:
      {{step.0.output}}
      
      Include:
      - Title and description
      - Installation
      - Usage examples
      - API overview
      - Contributing
      - License
```

**Usage:**
```bash
karl recipe:readme > README.md
karl recipe:readme --detailed
```

---

### 17. Code Smell Detector

```yaml
name: code-smells
description: Detect code smells and anti-patterns
tags: [quality, refactoring]

params:
  - name: file
    type: path
    required: true

steps:
  - name: Read code
    command: read
    file: "{{params.file}}"
  
  - name: Detect
    command: prompt
    template: |
      Detect code smells and anti-patterns:
      {{step.0.output}}
      
      Look for:
      - Long methods
      - God objects
      - Duplicate code
      - Magic numbers
      - Deep nesting
      - Too many parameters
      - Feature envy
      - Shotgun surgery patterns
      
      For each: location, smell type, refactoring suggestion.
```

**Usage:**
```bash
karl recipe:code-smells --file legacy.ts
```

---

### 18. Comment Cleanup

```yaml
name: comment-cleanup
description: Clean up and improve code comments
tags: [documentation, quality]

params:
  - name: file
    type: path
    required: true
  - name: action
    type: enum
    values: [remove-obvious, add-missing, improve-all]
    default: improve-all

steps:
  - name: Read code
    command: read
    file: "{{params.file}}"
  
  - name: Process comments
    command: prompt
    template: |
      {{#if params.action == "remove-obvious"}}
      Remove obvious/redundant comments from this code.
      {{else if params.action == "add-missing"}}
      Add helpful comments where they're missing.
      {{else}}
      Improve all comments: remove obvious ones, add missing ones, enhance existing ones.
      {{/if}}
      
      {{step.0.output}}
      
      Return the full code with improved comments.
```

**Usage:**
```bash
karl recipe:comment-cleanup --file src/utils.ts --action remove-obvious
```

---

### 19. Dependency Tree

```yaml
name: dependency-tree
description: Visualize module dependency tree
tags: [visualization, dependencies]

params:
  - name: entry
    type: path
    required: true
  - name: depth
    type: number
    default: 3

steps:
  - name: Find imports
    command: bash
    input: |
      # Simple import finder (could be language-specific)
      grep -r "import\|require\|from" {{params.entry}} | head -50
  
  - name: Generate tree
    command: prompt
    template: |
      Generate a dependency tree (max depth {{params.depth}}):
      {{step.0.output}}
      
      Output as ASCII tree or mermaid graph showing module dependencies.
```

**Usage:**
```bash
karl recipe:dependency-tree --entry src/index.ts
karl recipe:dependency-tree --entry main.py --depth 5
```

---

### 20. Pre-commit Check

```yaml
name: pre-commit-check
description: Comprehensive pre-commit validation
tags: [git, quality, ci]

steps:
  - name: Get staged files
    command: bash
    input: git diff --cached --name-only
  
  - name: Check for issues
    parallel: true
    steps:
      - name: secrets
        command: bash
        input: git diff --cached | grep -iE "(api_key|password|secret|token)" || true
      
      - name: console-logs
        command: bash
        input: git diff --cached | grep -E "console\.(log|debug)" || true
      
      - name: todos
        command: bash
        input: git diff --cached | grep -iE "(TODO|FIXME|XXX)" || true
  
  - name: Report
    command: prompt
    template: |
      Pre-commit check results:
      
      Staged files:
      {{step.0.output}}
      
      Potential secrets:
      {{step.1.secrets.output}}
      
      Console logs:
      {{step.1.console-logs.output}}
      
      TODOs:
      {{step.1.todos.output}}
      
      Should this commit proceed? If there are secrets, say NO.
      Otherwise, summarize what's being committed.
```

**Usage:**
```bash
# In .git/hooks/pre-commit
karl recipe:pre-commit-check
```

---

## Advanced Patterns

### Multi-Model Recipes

Use different models for different steps:

```yaml
name: comprehensive-review
steps:
  - name: quick-scan
    model: cliffy  # Fast initial scan
    command: prompt
    template: "Quick scan for obvious issues: {{file:input}}"
  
  - name: deep-review
    when: "{{step.0.output}} contains 'issues found'"
    model: opus  # Deep analysis only if needed
    command: prompt
    template: "Deep analysis: {{file:input}}"
```

### Dynamic Parameter Generation

```yaml
name: smart-review
steps:
  - name: detect-language
    command: bash
    input: file --mime-type {{params.file}}
  
  - name: review
    command: prompt
    skill: "{{step.0.output | extract_language}}"
    template: "Review this code..."
```

### Context Sharing

```yaml
name: project-review
steps:
  - name: setup-context
    command: context
    action: load
    files:
      - .karl/context/project-standards.md
      - docs/architecture.md
  
  - name: review
    command: prompt
    template: "Review against project standards: {{file:input}}"
```

### Error Handling

```yaml
name: safe-operation
steps:
  - name: risky-step
    command: bash
    input: some-command
    on_error: continue
  
  - name: handle-error
    when: "{{step.0.exit_code}} != 0"
    command: prompt
    template: "This failed: {{step.0.error}}. Suggest fix?"
```

### Loops and Iteration

```yaml
name: batch-process
params:
  - name: files
    type: array

steps:
  - name: process
    for_each: "{{params.files}}"
    command: prompt
    template: "Process {{item}}: {{file:item}}"
```

---

## Creating Your First Recipe

### 1. Identify the Workflow

What repetitive task do you do? Examples:
- Reviewing PRs before merge
- Updating package versions
- Writing error messages
- Generating boilerplate

### 2. Break Into Steps

```
1. Gather input (git diff, file, stdin)
2. Process/analyze (prompt, bash, read)
3. Output result (stdout, file, clipboard)
```

### 3. Start Simple

```yaml
name: my-first-recipe
description: What it does

steps:
  - command: prompt
    template: "Do the thing: {{stdin}}"
```

### 4. Test It

```bash
karl recipe:my-first-recipe --dry-run
```

### 5. Iterate

Add parameters, error handling, better prompts.

### 6. Share

```bash
# Commit to your project
git add .karl/recipes/my-first-recipe.yml

# Or publish to registry
karl recipe:publish my-first-recipe
```

---

## Best Practices

### 1. **Make Recipes Focused**
One recipe = one workflow. Don't create mega-recipes.

### 2. **Provide Defaults**
Make recipes work with minimal parameters.

### 3. **Use Descriptive Names**
`generate-api-docs` > `docs` > `gd`

### 4. **Add Examples**
Include usage examples in the description.

### 5. **Handle Errors**
Check for required tools, files, etc.

### 6. **Be Model-Conscious**
Use `cliffy` for simple tasks, `opus` for complex ones.

### 7. **Leverage Skills**
Don't repeat domain knowledge, reference skills.

### 8. **Test Recipes**
Write tests for recipes that others will use.

### 9. **Version Control**
Track recipe changes in git with your project.

### 10. **Document Parameters**
Clear descriptions help users understand what to provide.

---

## Next Steps

1. **Browse builtin recipes**: `karl recipes --builtin`
2. **Create your first recipe** in `.karl/recipes/`
3. **Share with your team** via git
4. **Explore the registry**: `karl recipe:search`
5. **Integrate with your build** tools (npm, make, etc.)

---

## Implementation Roadmap

This document describes the ideal state. Implementation phases:

### Phase 1: Core (MVP)
- [ ] Basic YAML recipe parsing
- [ ] Simple step execution (prompt, bash, read, write)
- [ ] Parameter substitution
- [ ] Built-in recipe location
- [ ] `karl recipe:name` execution

### Phase 2: Features
- [ ] Recipe chaining
- [ ] Parallel execution
- [ ] Conditional steps
- [ ] User/project recipe locations
- [ ] Recipe listing/info

### Phase 3: Advanced
- [ ] Recipe testing framework
- [ ] Community registry
- [ ] Recipe manifest/dependencies
- [ ] Dynamic parameters
- [ ] Context integration

### Phase 4: Polish
- [ ] IDE integration helpers
- [ ] Recipe validation/linting
- [ ] Performance optimization
- [ ] Comprehensive builtin recipe library

---

**The recipe system turns Karl from a powerful tool into a team platform.**

Serve. Volley. Ace. 🎾
