# Karl Context Workflows

*"Pack context densely. Don't let models waste tokens on discovery."*

## The Core Pattern

```
Context Building → Discovery → Planning → Implementation → Review
       (bash)       (karl)       (karl)        (karl)        (karl)
```

Each phase uses the right tool:
- **Context Building**: Unix tools (icli, tree, cat, rg)
- **AI Phases**: karl with specialized skills

---

## Pattern 1: The Context File

Build context once, use it everywhere.

```bash
# Build rich context file
{
  echo "# Project: karl"
  echo ""
  icli context karl
  echo ""
  echo "## Code Structure"
  tree -L 2 packages/karl/src
  echo ""
  echo "## Key Files (codemaps)"
  echo ""
  echo "### runner.ts"
  karl run --model trinity --skill codemap "$(cat packages/karl/src/runner.ts)"
  echo ""
  echo "### config.ts"
  karl run --model trinity --skill codemap "$(cat packages/karl/src/config.ts)"
} > /tmp/karl-context.md

# Now use it
karl run --model devstral --skill discover \
  --context-file /tmp/karl-context.md \
  "I want to add caching to the runner"
```

---

## Pattern 2: The Pipeline

Chain karl calls, each receiving the previous output as context.

```bash
# Discovery → Architecture pipeline
karl run --model trinity --skill discover \
  --context-file /tmp/karl-context.md \
  "Add rate limiting to API" \
| karl run --model devstral --skill architect \
  --context-file - \
  "Design the solution based on discovery above"
```

The `--context-file -` reads stdin as context, keeping the task as a positional argument.

---

## Pattern 3: Parallel Context Building

Gather context from multiple sources concurrently.

```bash
# Build context pieces in parallel
(
  echo "## Project Analysis"
  icli context karl
) > /tmp/ctx-analysis.md &

(
  echo "## File Structure"
  tree -L 3 packages/
) > /tmp/ctx-tree.md &

(
  echo "## Recent Changes"
  git log --oneline -10
  echo ""
  git diff --stat HEAD~5
) > /tmp/ctx-git.md &

wait

# Combine
cat /tmp/ctx-analysis.md /tmp/ctx-tree.md /tmp/ctx-git.md > /tmp/context.md

# Use
karl run --model devstral --skill discover \
  --context-file /tmp/context.md \
  "Why is the build failing?"
```

---

## Pattern 4: Targeted Context

Don't include everything. Include what matters.

```bash
# For a specific bug, include only relevant files
{
  echo "# Bug Context"
  echo ""
  echo "## Error"
  echo '```'
  cat error.log | tail -50
  echo '```'
  echo ""
  echo "## Likely Files"
  echo ""
  # Use rg to find related code
  rg -l "runTask" packages/karl/src/ | while read f; do
    echo "### $f"
    echo '```typescript'
    cat "$f"
    echo '```'
  done
} > /tmp/bug-context.md

karl run --model devstral --skill discover \
  --context-file /tmp/bug-context.md \
  "Why is runTask timing out?"
```

---

## Pattern 5: Token Budget Awareness

Different phases need different context density.

```bash
# Discovery phase: broad but shallow (codemaps)
{
  icli context myproject
  tree -L 2 src/
  # Codemaps for all major files
  for f in src/*.ts; do
    echo "### $f (codemap)"
    karl run --model trinity --skill codemap "$(cat $f)"
  done
} > /tmp/broad-context.md

# Implementation phase: narrow but deep (full files)
{
  echo "# Implementation Context"
  echo ""
  echo "## Files to Edit"
  cat src/auth.ts      # Full content
  cat src/middleware.ts # Full content
  echo ""
  echo "## Reference (codemaps)"
  karl run --model trinity --skill codemap "$(cat src/types.ts)"
} > /tmp/deep-context.md
```

---

## Pattern 6: The Handoff

Discovery produces handoff, architecture consumes it.

```bash
# Phase 1: Discover and create handoff
karl run --model devstral --skill discover \
  --context-file /tmp/context.md \
  "Add user authentication" \
| karl run --model devstral --skill handoff \
  --context-file - \
  "Create handoff from discovery" \
> /tmp/handoff.md

# Phase 2: Architect with handoff
karl run --model devstral --skill architect \
  --context-file /tmp/handoff.md \
  "Implement the auth system described above" \
> /tmp/plan.md

# Phase 3: Review the plan
karl run --model devstral --skill clarify \
  --context-file /tmp/plan.md \
  "What could go wrong with this plan?"
```

---

## Pattern 7: Model Routing

Use fast models for simple tasks, powerful models for complex ones.

```bash
# Fast model for extraction/codemap (trinity = free)
karl run --model trinity --skill codemap "$(cat src/big-file.ts)"

# Medium model for discovery (devstral = free, good at code)
karl run --model devstral --skill discover \
  --context-file /tmp/context.md "task"

# Powerful model for architecture (when you need it)
karl run --model opus --skill architect \
  --context-file /tmp/handoff.md "complex task"
```

---

## Pattern 8: Shell Functions

Create reusable functions for common workflows.

```bash
# Add to ~/.bashrc or ~/.zshrc

# Build context for a project
karl-context() {
  local project="${1:-.}"
  {
    icli context "$project" 2>/dev/null || echo "# $project"
    echo ""
    tree -L 2 "$project"
  }
}

# Quick discovery (context piped in)
karl-discover() {
  local task="$1"
  shift
  karl-context "${1:-.}" | karl run --model devstral --skill discover \
    --context-file - "$task"
}

# Full workflow: discover → architect
karl-plan() {
  local task="$1"
  local project="${2:-.}"

  karl-context "$project" > /tmp/ctx.md
  karl run --model devstral --skill discover \
    --context-file /tmp/ctx.md "$task" \
  | karl run --model devstral --skill architect \
    --context-file - "Design the solution"
}

# Usage:
# karl-discover "add caching" ./my-project
# karl-plan "implement user auth"
```

---

## Token Budget Reference

| Phase | Target Tokens | Strategy |
|-------|---------------|----------|
| Discovery | 60-80k | Broad context, codemaps |
| Architecture | 40-60k | Handoff + reference codemaps |
| Implementation | 20-40k | Full files being edited only |
| Review | 20-30k | Implementation + diffs |

Models have effective context < advertised:
- Advertised 128k → Effective ~64k
- Beyond 64k, reasoning degrades

---

## The Philosophy

1. **Context is king** - Pack it densely, pack it well
2. **Phases are different** - Discovery != Implementation
3. **Unix pipes are your friend** - Compose small tools
4. **Token budget matters** - Know your effective window
5. **Codemaps save tokens** - 10x more files at 1/10th cost
6. **Handoffs bridge phases** - Discovery → Implementation

---

*"The master of context packs wisdom into tokens. The master of karl chains insights into understanding."*
