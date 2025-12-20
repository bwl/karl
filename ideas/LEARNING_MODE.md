# Learning Mode: Karl Gets Smarter With You

> "The best serve is the one your opponent doesn't expect—but you've practiced a thousand times."

Karl learns from your patterns to serve you better. **All learning happens locally.** No telemetry, no cloud sync, no creepy tracking. Just a helpful assistant that remembers what works for you.

## Philosophy

- **Privacy First**: Everything stays on your machine in `.karl/learned/`
- **Transparent**: See what Karl learned, edit it, delete it
- **Helpful, Not Creepy**: Suggestions, not assumptions
- **Opt-In by Default**: You control what gets learned
- **Project-Aware**: Different projects have different patterns
- **Easily Forgotten**: Reset anytime, no questions asked

---

## What Karl Learns

### 1. Common Task Patterns

Karl notices tasks you repeat and offers shortcuts:

```bash
# After you run this a few times:
karl --stack sonnet "Review this PR for security issues" < diff.txt

# Karl suggests:
💡 You often review PRs with sonnet. Create an alias?
   karl alias pr-review "karl --stack sonnet 'Review this PR for security issues'"
```

**Patterns detected:**
- Repeated prompt templates
- Frequent file/directory arguments
- Common piping patterns
- Task categories (code review, refactoring, docs, etc.)

### 2. Model Preferences by Task Type

Karl learns which models you prefer for different work:

```json
{
  "model_preferences": {
    "code_review": { "sonnet": 0.8, "opus": 0.2 },
    "quick_fixes": { "cliffy": 0.9, "sonnet": 0.1 },
    "architecture": { "opus": 1.0 },
    "documentation": { "sonnet": 0.7, "cliffy": 0.3 }
  }
}
```

**Auto-suggestions:**
```bash
karl "Design a distributed caching system"
💡 Based on architecture tasks, suggest using --stack opus
```

### 3. Skill Usage Patterns

Track which skills get used together:

```bash
# You often use:
karl --skill typescript --skill testing "Add tests for..."

# Karl learns:
💡 When using typescript skill, you also use testing 85% of the time.
   Add --skill testing automatically? (y/n/never)
```

**Skill co-occurrence matrix:**
- `typescript` + `testing` → 85%
- `python` + `ml` → 72%
- `security` + `code_review` → 91%

### 4. Project-Specific Patterns

Each project can have its own learned patterns:

```
.karl/learned/
├── global.json           # Cross-project learnings
├── project-hash.json     # This project (git repo hash)
└── workspaces/
    ├── web-app.json      # Named workspace patterns
    └── api-service.json
```

**Example project learning:**
```json
{
  "project": "ecommerce-api",
  "preferred_stack": "sonnet",
  "common_files": [
    "src/**/*.ts",
    "tests/**/*.test.ts"
  ],
  "frequent_tasks": [
    { "type": "test_generation", "count": 47 },
    { "type": "api_docs", "count": 23 }
  ],
  "skill_defaults": ["typescript", "testing", "api-design"]
}
```

### 5. Context Preferences

Learn what context you typically provide:

- File patterns (always include `tsconfig.json` for TS projects)
- Directory scope (usually `src/` not `node_modules/`)
- Skill combinations
- Context size preferences

### 6. Time-Based Patterns

Subtle patterns that improve UX:

- Morning: code reviews and planning (prefer opus)
- Afternoon: implementation (prefer sonnet/cliffy)
- Evening: documentation (prefer sonnet)

**Not creepy because**: Only suggests, never assumes. Easy to disable.

---

## Learning Mechanisms

### Passive Learning (Opt-In)

```bash
# Enable learning mode
karl config set learning.enabled true

# Learning runs in background, no interruptions
# Builds statistical model from your usage
```

### Active Learning (Explicit)

```bash
# Save this exact command as an alias
karl learn alias "pr-review" --last

# Remember this model choice for this task type
karl learn model opus --for "architecture design"

# Always use these skills together
karl learn skills typescript,testing --together
```

### Interactive Suggestions

Karl asks before creating shortcuts:

```bash
karl "Fix the login bug" --stack opus

# After 3 similar uses:
╭─ Learning Suggestion ─────────────────────────╮
│ You've used 'opus' for 'bug fixing' 3 times  │
│ Make this the default for bug-related tasks? │
│                                               │
│ [y] Yes, remember    [n] Not now             │
│ [v] View learning    [x] Never suggest       │
╰───────────────────────────────────────────────╯
```

---

## Auto-Generated Shortcuts

### Smart Aliases

Based on frequency and pattern matching:

```bash
# Karl auto-suggests after detecting pattern
karl alias test "karl --skill typescript,testing 'Generate tests for'"
karl alias review "karl --stack sonnet --skill security 'Review for security issues:'"
karl alias doc "karl --skill docs 'Generate documentation for'"

# Use them:
echo "src/auth.ts" | karl test
git diff | karl review
karl doc < src/api.ts
```

### Parameterized Aliases

```bash
# Karl detects you always change one part
karl alias fix "karl --stack $1 'Fix the issue in' $2"

# Expands to:
fix cliffy auth.ts → karl --stack cliffy 'Fix the issue in' auth.ts
```

### Skill Bundles

```bash
# Auto-created from usage patterns
karl skill-bundle web "typescript,react,testing,css"
karl skill-bundle backend "python,sql,api-design,security"

# Use with:
karl --bundle web "Build a login form"
```

---

## Model Preference Learning

### Detection Algorithm

```python
# Simplified logic
def detect_task_type(prompt):
    keywords = {
        'architecture': ['design', 'architect', 'system', 'structure'],
        'bug_fix': ['fix', 'bug', 'error', 'issue', 'broken'],
        'refactor': ['refactor', 'improve', 'clean', 'reorganize'],
        'test': ['test', 'spec', 'coverage'],
        'docs': ['document', 'explain', 'readme', 'comment']
    }
    # Pattern matching + context analysis
    return matched_category

def learn_preference(task_type, model, success):
    # Track which models user chooses for which tasks
    # Weight by recency and success indicators
    update_preference_weights(task_type, model)
```

### Preference Storage

```json
{
  "model_preferences": {
    "bug_fix": {
      "weights": { "cliffy": 0.3, "sonnet": 0.6, "opus": 0.1 },
      "sample_size": 23,
      "confidence": 0.85,
      "last_updated": "2025-01-15T10:30:00Z"
    }
  }
}
```

### Smart Suggestions

```bash
# Low confidence = gentle suggestion
karl "Fix auth timeout"
💡 Suggestion: --stack sonnet (65% confidence)

# High confidence = stronger suggestion
karl "Design event sourcing architecture"
⚡ Recommended: --stack opus (95% confidence)
   Override with --stack <name>

# Very high confidence = auto-select (with notice)
karl "Quick typo fix in README"
🎾 Using cliffy (learned preference for quick fixes)
```

---

## Implementation Details

### Storage: Local JSON + SQLite

```
.karl/learned/
├── global.db          # SQLite for queryable data
├── global.json        # Human-readable backup
├── aliases.json       # User-created aliases
├── preferences.json   # Model/skill preferences
└── stats.json         # Usage statistics
```

**SQLite Schema:**
```sql
CREATE TABLE tasks (
    id INTEGER PRIMARY KEY,
    timestamp TEXT,
    task_type TEXT,
    model_used TEXT,
    skills_used TEXT,
    context_files TEXT,
    success_indicators INTEGER,
    project_hash TEXT
);

CREATE TABLE preferences (
    task_type TEXT PRIMARY KEY,
    model_weights TEXT, -- JSON
    skill_weights TEXT, -- JSON
    confidence REAL,
    sample_size INTEGER
);

CREATE TABLE aliases (
    name TEXT PRIMARY KEY,
    command TEXT,
    usage_count INTEGER,
    created_at TEXT,
    last_used TEXT
);
```

### Privacy Guarantees

- ✅ All data stays in `.karl/learned/` on your machine
- ✅ No network requests for learning features
- ✅ Git-ignored by default (in `.gitignore`)
- ✅ Plain text formats (JSON/SQLite, inspectable)
- ✅ Easy to delete, export, or edit manually
- ✅ No prompt content stored (only metadata/patterns)

### What Gets Stored

**YES:**
- Task type classifications (e.g., "bug_fix", "architecture")
- Model choices
- Skill combinations
- File patterns (e.g., "*.ts", "src/")
- Success signals (completion, no errors)
- Timestamps (for recency weighting)

**NO:**
- Actual prompt content
- File contents
- Output/responses
- API keys or secrets
- Personally identifiable information

---

## Transparency & Control

### View What Karl Learned

```bash
# See all learning data
karl learning show

# Output:
╭─ Karl's Learning Summary ─────────────────╮
│ Learning Mode: ✓ Enabled                  │
│ Tasks Analyzed: 342                        │
│ Aliases Created: 5                         │
│ Model Preferences: 8                       │
│ Skill Bundles: 3                           │
╰────────────────────────────────────────────╯

Model Preferences:
  architecture → opus (95% confidence, n=12)
  bug_fix → sonnet (78% confidence, n=45)
  quick_edits → cliffy (91% confidence, n=89)

Skill Patterns:
  typescript + testing (used together 87% of the time)
  security + code_review (used together 94% of the time)

Aliases:
  test → karl --skill typescript,testing 'Generate tests'
  review → karl --stack sonnet --skill security 'Review for security'
```

### Edit Learning Data

```bash
# Open in $EDITOR
karl learning edit

# Remove specific learning
karl learning forget model-preference bug_fix
karl learning forget alias test
karl learning forget skill-pattern "typescript+testing"

# Export for backup/inspection
karl learning export > my-karl-learning.json

# Import (merge or replace)
karl learning import my-karl-learning.json --merge
```

### Reset Everything

```bash
# Clear all learning (keeps config)
karl learning reset

# Confirm with tennis flair:
🎾 Reset all learned patterns?
   This will forget:
   - 342 task analyses
   - 5 aliases
   - 8 model preferences
   - 3 skill bundles

   [y] Yes, reset    [n] Cancel    [b] Backup first

# Surgical resets
karl learning reset --aliases-only
karl learning reset --preferences-only
karl learning reset --project-only
```

---

## Configuration

### Learning Settings

```bash
# Enable/disable learning
karl config set learning.enabled true

# Set learning aggressiveness
karl config set learning.suggestion_threshold 3  # Suggest after 3 patterns
karl config set learning.confidence_threshold 0.7  # 70% confidence to suggest

# What to learn
karl config set learning.track_models true
karl config set learning.track_skills true
karl config set learning.track_aliases true
karl config set learning.track_time_patterns false  # Opt-out of time-based

# Suggestion style
karl config set learning.auto_suggest true   # Show suggestions
karl config set learning.auto_apply false    # Don't auto-apply (ask first)

# Project vs global
karl config set learning.scope project  # project | global | both
```

### Per-Project Overrides

```json
// .karl/config.json
{
  "learning": {
    "enabled": true,
    "scope": "project",
    "preferences": {
      "default_stack": "sonnet",
      "default_skills": ["typescript", "testing"]
    }
  }
}
```

---

## Use Cases & Examples

### Example 1: Bug Fix Workflow

```bash
# First time
karl --stack opus "Fix the memory leak in cache.ts"

# After 3-4 times Karl learns:
# - You prefer opus for bug fixes
# - You often reference cache.ts
# - You use --skill debugging when available

# Next time:
karl "Fix the timeout in api.ts"
⚡ Recommended: --stack opus (learned from bug fix patterns)
```

### Example 2: Testing Workflow

```bash
# You often run:
karl --skill typescript --skill testing "Generate tests for" src/auth.ts
karl --skill typescript --skill testing "Add edge case tests for" src/payment.ts

# Karl suggests:
💡 Create alias?
   karl alias test "karl --skill typescript,testing 'Generate tests for'"

# Accept, then use:
karl test src/newfeature.ts
```

### Example 3: Project Onboarding

```bash
# New project, first few tasks
cd new-project
karl --stack sonnet --skill python --skill sql "Explain this schema"

# Over time, Karl learns this is a Python/SQL project
# On 5th task:
karl "Add a new table for user preferences"

🎾 Using learned project defaults:
   --stack sonnet --skill python,sql
   (Override with explicit flags)
```

### Example 4: Context Evolution

```bash
# You often include certain files
karl "Refactor auth logic" src/auth.ts src/types.ts src/config.ts

# After pattern detection:
💡 When refactoring auth, you usually include:
   - src/auth.ts
   - src/types.ts  
   - src/config.ts
   
   Create context template? (y/n)

# Later:
karl --context auth-refactor "Add 2FA support"
# Auto-includes learned files
```

---

## Advanced Features

### Skill Recommendation Engine

```bash
karl "Build a REST API for user management"

🎾 Analyzing task...
💡 Suggested skills based on similar tasks:
   --skill api-design (used 89% of the time for API tasks)
   --skill security (used 76% of the time for auth-related APIs)
   --skill testing (used 65% of the time)
   
   Apply all? [y/n/pick]
```

### Confidence Levels

- **🟢 High (>85%)**: Auto-apply with notification
- **🟡 Medium (60-85%)**: Strong suggestion
- **🟠 Low (40-60%)**: Gentle suggestion
- **⚪ Very Low (<40%)**: No suggestion

### Success Indicators

Karl infers success from:
- ✅ Task completed (exit code 0)
- ✅ No immediate retry (no repeat within 2 mins)
- ✅ Model didn't error out
- ✅ User didn't Ctrl+C mid-task
- ✅ Same task type not repeated with different model

### Decay & Recency

Preferences decay over time to adapt to changing habits:

```python
weight = base_weight * (0.95 ** days_since_last_use)
```

Old patterns fade, recent patterns strengthen.

---

## FAQ

### How is this different from shell history?

Shell history is literal commands. Karl's learning is semantic—understanding *what kind of task* you're doing and *how you prefer to do it*, not just command strings.

### Can I sync learning across machines?

Not by default (privacy). But you can:
```bash
karl learning export > ~/Dropbox/karl-learning.json
# On other machine:
karl learning import ~/Dropbox/karl-learning.json --merge
```

### What if Karl learns the wrong thing?

Easy to correct:
```bash
karl learning forget model-preference bug_fix
karl learning set model-preference bug_fix cliffy
```

### Does this slow down Karl?

No. Learning happens:
- Async after task completion (non-blocking)
- In-memory during session
- Persisted to disk on exit
- Fast SQLite queries (<1ms)

### Can I disable learning but keep using aliases?

Yes:
```bash
karl config set learning.enabled false
# Aliases still work, just won't create new ones
```

### What about false positives?

Karl uses conservative thresholds and always asks before creating automation. You're in control.

---

## Roadmap

### v1: Basic Learning (MVP)
- ✅ Task type classification
- ✅ Model preference tracking
- ✅ Simple alias suggestions
- ✅ Local JSON storage

### v2: Smart Suggestions
- ✅ Skill co-occurrence
- ✅ Context templates
- ✅ Confidence-based auto-apply
- ✅ SQLite for queryable history

### v3: Advanced Patterns
- 🔲 Multi-step workflow learning
- 🔲 Cross-project pattern sharing (opt-in)
- 🔲 Natural language alias creation
- 🔲 A/B testing suggestions (try opus vs sonnet, track outcomes)

### v4: Team Learning (Future)
- 🔲 Export/import team best practices
- 🔲 Shared skill bundles
- 🔲 Project templates with learned preferences
- 🔲 Still local-first, explicit sharing only

---

## Tennis Analogy

Learning Mode is like a tennis player studying their opponent:

- **Serve patterns**: What tasks you serve Karl
- **Return style**: Which models you prefer
- **Court position**: What context you provide
- **Shot selection**: Which skills you combine

Over time, Karl anticipates your next move—not to replace your judgment, but to have the right racket ready.

**The ace is still yours. Karl just learned your favorite serve.**

---

## Implementation Checklist

- [ ] SQLite schema setup
- [ ] Task type classifier (keyword + context analysis)
- [ ] Model preference tracker
- [ ] Skill co-occurrence matrix
- [ ] Alias suggestion engine
- [ ] Interactive prompt system
- [ ] `karl learning` subcommand
- [ ] Export/import functionality
- [ ] Reset and forget commands
- [ ] Confidence threshold logic
- [ ] Success indicator heuristics
- [ ] Decay algorithm for recency
- [ ] Privacy audit (no sensitive data leakage)
- [ ] Documentation and examples
- [ ] Tests for learning algorithms

---

## Philosophy Statement

**Karl learns to serve you better, not to control you.**

- Your privacy is sacred
- Your decisions are final
- Your patterns are yours alone
- Your trust is earned through transparency

Learning Mode is a caddy, not a coach. It remembers what club you like for this shot, but never swings for you.

🎾 **Ace it.**
