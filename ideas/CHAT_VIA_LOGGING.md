# Chat via Logging: Git for Conversations

## Philosophy

Karl avoids traditional stateful chat. Instead, we treat conversations like version control:
- Every response is a commit
- Logs are your conversation history
- Reference by ID, tag, or relative offset
- Branch, fork, and merge conversation threads
- Replay and diff between attempts
- No hidden state files—just append-only logs

**The Tennis Analogy**: Think of logs as match statistics. Each serve gets recorded. You can review past aces, replay points, or start a new game from any previous position.

---

## Structured Log Format

### Response Entry Schema

Each Karl invocation appends a JSON entry to `~/.karl/logs/responses.jsonl`:

```json
{
  "id": "ace_2024_01_15_14_32_18_a8f3",
  "timestamp": "2024-01-15T14:32:18.492Z",
  "command": "karl 'refactor user auth'",
  "stack": "sonnet",
  "skills": ["typescript", "security"],
  "prompt": "refactor user auth to use JWT tokens",
  "response": {
    "text": "I'll refactor the authentication...",
    "tools_used": ["read", "edit", "write"],
    "files_modified": ["src/auth.ts", "src/middleware/jwt.ts"],
    "tokens": {
      "input": 1250,
      "output": 890,
      "cost_usd": 0.0234
    }
  },
  "parent": "ace_2024_01_15_13_15_42_b2c1",
  "tags": ["auth", "security"],
  "exit_code": 0,
  "duration_ms": 4821
}
```

### Key Fields

- **id**: Unique identifier (`ace_<timestamp>_<short_hash>`)
- **parent**: Previous response ID for conversation chains
- **tags**: User-defined labels for filtering
- **response.text**: Full model output
- **response.files_modified**: Changed files for diffing
- **command**: Exact CLI invocation for replay

---

## Referencing Previous Responses

### By ID (Absolute)

```bash
# Reference specific response
karl reply @ace_2024_01_15_14_32_18_a8f3 "now add refresh tokens"

# Use short hash (first 8 chars minimum)
karl reply @ace_a8f3 "explain the security model"
```

### By Offset (Relative)

```bash
# Last response
karl reply @last "add error handling"
karl reply @-1 "add error handling"  # equivalent

# Two responses ago
karl reply @-2 "actually, use the approach from earlier"

# First response in session
karl reply @first "let's try a different direction"
```

### By Tag

```bash
# Most recent response with tag
karl reply @tag:auth "optimize the token validation"

# Specific tagged response
karl reply @tag:auth:2 "second auth-related response"
```

### By Time Range

```bash
# Today's responses
karl list --today

# Last hour
karl list --since 1h

# Specific date
karl list --date 2024-01-15
```

---

## Building Conversation Chains

### Linear Chains (Traditional Chat)

```bash
# Initial prompt
karl "design a URL shortener API"
# → ace_001a

# Follow-up automatically chains
karl reply @last "add rate limiting"
# → ace_002b (parent: ace_001a)

# Continue the thread
karl reply @last "show example requests"
# → ace_003c (parent: ace_002b)

# View the chain
karl chain @last
# Shows: ace_001a → ace_002b → ace_003c
```

### Chain Visualization

```bash
karl chain @ace_003c --graph
```

Output:
```
ace_001a  "design a URL shortener API"
  ↓
ace_002b  "add rate limiting" [+2 files]
  ↓
ace_003c  "show example requests"
```

---

## Fork & Branch Conversations

### Forking from Any Point

```bash
# Original chain
karl "create user service"           # ace_001a
karl reply @last "add validation"    # ace_002b
karl reply @last "add tests"         # ace_003c

# Fork from middle point
karl reply @ace_002b "use Zod instead of custom validation"
# → ace_004d (parent: ace_002b)

# Now you have:
#   ace_001a → ace_002b → ace_003c
#                      ↘ ace_004d
```

### Branch Comparison

```bash
# Compare two branches
karl diff @ace_003c @ace_004d

# Show which files diverged
karl diff @ace_003c @ace_004d --files-only
```

### Cherry-Pick Between Branches

```bash
# Apply changes from another branch
karl cherry-pick @ace_004d --onto @last

# Merge conversation branches
karl merge @ace_004d "combine both approaches"
```

---

## Replay & Diff

### Replay Exact Commands

```bash
# Replay a previous response
karl replay @ace_002b

# Replay with different stack
karl replay @ace_002b --stack opus

# Replay entire chain
karl replay @ace_003c --chain

# Dry run (show what would execute)
karl replay @ace_002b --dry-run
```

### Diff Between Responses

```bash
# Show output differences
karl diff @ace_002b @ace_002b_replay

# Show only code changes
karl diff @ace_002b @ace_002b_replay --code-only

# Unified diff format
karl diff @ace_002b @ace_002b_replay --unified
```

**Example Output:**
```diff
Response: ace_002b vs ace_002b_replay
Stack: sonnet vs opus

Files Modified:
  Both: src/validation.ts
  Only in ace_002b: src/utils.ts
  Only in ace_002b_replay: src/schemas.ts

--- src/validation.ts (ace_002b)
+++ src/validation.ts (ace_002b_replay)
@@ -12,3 +12,5 @@
-  if (!email.includes('@')) throw new Error('Invalid email');
+  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
+  if (!emailRegex.test(email)) throw new Error('Invalid email');
```

---

## Session Persistence Without State

### Implicit Sessions (Time-Based)

Karl auto-groups responses by time gaps:

```bash
# Responses within 30 min are "same session"
karl list --session current

# Previous session
karl list --session -1

# All sessions today
karl sessions --today
```

### Explicit Session Tags

```bash
# Tag responses during work
karl "setup database" --tag project:urlshort --tag session:init

# Later, reference the session
karl list --tag session:init
karl reply @tag:session:init:last "add migrations"
```

### Session Exports

```bash
# Export session as markdown
karl export @session:current > session_2024_01_15.md

# Export as JSON for tools
karl export @session:current --json | jq '.[] | .response.files_modified'

# Create shareable context
karl export @tag:project:urlshort --context > context.md
```

---

## Reference Syntax Summary

| Syntax | Meaning | Example |
|--------|---------|---------|
| `@<full-id>` | Exact ID | `@ace_2024_01_15_14_32_18_a8f3` |
| `@<short-hash>` | Short ID (8+ chars) | `@ace_a8f3` |
| `@last` or `@-1` | Last response | `karl reply @last "continue"` |
| `@-N` | N responses ago | `@-3` |
| `@first` | First response | `@first` |
| `@tag:<name>` | Tagged response | `@tag:auth` |
| `@tag:<name>:<n>` | Nth tagged | `@tag:auth:2` |
| `@session:current` | Current session | `@session:current` |
| `@session:-N` | N sessions ago | `@session:-1` |

---

## Log Storage & Rotation

### File Structure

```
~/.karl/logs/
├── responses.jsonl           # Main append-only log
├── responses.2024-01.jsonl   # Rotated monthly
├── responses.2023-12.jsonl
├── index.db                  # SQLite index for fast queries
└── archives/
    └── 2023/
        └── responses.2023.jsonl.gz
```

### Rotation Strategy

**Automatic Rotation:**
- Monthly rotation by default
- Compress archives older than 90 days
- Keep index database for all responses

**Manual Control:**
```bash
# Force rotation now
karl logs rotate

# Archive logs older than 30 days
karl logs archive --older-than 30d

# Compact and rebuild index
karl logs compact
```

### Log Size Management

```bash
# Show log statistics
karl logs stats
# → Total responses: 1,247
# → Total size: 12.4 MB
# → Oldest: 2023-06-15
# → Sessions: 89

# Prune old responses
karl logs prune --older-than 180d

# Keep only tagged responses when pruning
karl logs prune --keep-tagged
```

---

## Privacy Considerations

### Sensitive Data Handling

**Problem:** Logs may contain API keys, secrets, PII from prompts/responses.

**Solutions:**

#### 1. Redaction Patterns

```bash
# Configure in ~/.karl/config.toml
[logs]
redact_patterns = [
  'sk-[a-zA-Z0-9]{32}',          # API keys
  '\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b',  # Emails
  '\b\d{3}-\d{2}-\d{4}\b',       # SSNs
]

# Test redaction
karl logs redact --dry-run
```

#### 2. Selective Logging

```bash
# Disable logging for sensitive prompts
karl "process user data" --no-log

# Log command only, not response
karl "analyze secrets.txt" --log-command-only
```

#### 3. Encrypted Logs

```bash
# Enable GPG encryption
karl config set logs.encrypt true
karl config set logs.gpg_key user@example.com

# Logs are encrypted at rest
# Commands auto-decrypt when needed
```

#### 4. Local-Only Mode

```bash
# Never log cloud API responses
karl config set logs.local_only true

# Only log devstral/local model responses
```

### GDPR/Compliance

```bash
# Export all logs (data portability)
karl logs export --all > my_karl_data.json

# Delete all logs (right to be forgotten)
karl logs delete --all --confirm

# Delete specific time range
karl logs delete --between 2024-01-01 2024-01-31

# Anonymize old logs (remove prompts, keep metadata)
karl logs anonymize --older-than 90d
```

---

## Example Workflows

### Workflow 1: Iterative Development

```bash
# Start fresh
karl "create a REST API for todo items" --tag project:todo
# → ace_001a

# Review and continue
karl reply @last "add authentication"
# → ace_002b

# Not happy, try different approach
karl reply @ace_001a "use GraphQL instead of REST"
# → ace_003c

# Compare approaches
karl diff @ace_002b @ace_003c --files-only
# → Shows REST auth vs GraphQL approach

# Choose winner and continue
karl reply @ace_003c "add subscriptions for real-time updates"
# → ace_004d

# Export the winning chain
karl chain @ace_004d --export > todo_api_implementation.md
```

### Workflow 2: Debugging Session

```bash
# Initial bug report
karl "fix authentication failing in production" --tag bug:auth
# → ace_101a

# Test solution
npm test  # Fails

# Try again with more context
karl reply @last "tests are still failing, here's the error: $(npm test 2>&1)"
# → ace_102b

# Still broken, fork back and try different approach
karl reply @ace_101a "use a different JWT library" --tag attempt:2
# → ace_103c

npm test  # Success!

# Document the winning solution
karl export @ace_103c --with-chain > bug_fix_auth_2024_01_15.md

# Tag for future reference
karl tag @ace_103c "solution:jwt-library-change"
```

### Workflow 3: Exploration & Research

```bash
# Multiple parallel explorations
karl "research options for rate limiting" --tag research:ratelimit:option-a
# → ace_201a

karl "research rate limiting with Redis" --tag research:ratelimit:option-b
# → ace_202b

karl "research rate limiting with token bucket" --tag research:ratelimit:option-c
# → ace_203c

# Review all options
karl list --tag research:ratelimit

# Synthesize findings
karl "compare these approaches: @ace_201a @ace_202b @ace_203c" --tag research:summary
# → ace_204d

# Build on chosen approach
karl reply @ace_202b "implement Redis rate limiting with sliding window"
# → ace_205e
```

### Workflow 4: Code Review Assistant

```bash
# Review current changes
git diff main | karl "review this diff for security issues" --tag review:security
# → ace_301a

# Fix issues
karl reply @last "apply these fixes"
# → ace_302b

# Verify
git diff main | karl "check if previous security issues are fixed" --parent @ace_301a
# → ace_303c

# Export review chain for PR
karl chain @ace_303c --export --format markdown > PR_REVIEW.md
```

### Workflow 5: Daily Standup Logs

```bash
# Morning: Plan the day
karl "outline tasks for implementing user dashboard" --tag standup:plan:2024-01-15
# → ace_401a

# Work session (multiple responses throughout day)
karl reply @last "start with data fetching layer"
# → ace_402b

# ... more work ...

# End of day: Review
karl sessions --today | karl "summarize what was accomplished"
# → ace_410j

# Share with team
karl export @session:current --format slack > standup_2024_01_15.txt
```

---

## Implementation Approach

### Phase 1: Basic Logging

**Milestone:** Every response logged with ID and timestamp

```typescript
// src/logging/logger.ts
interface ResponseLog {
  id: string;
  timestamp: string;
  command: string;
  prompt: string;
  response: string;
  stack: string;
  exit_code: number;
}

async function logResponse(data: ResponseLog) {
  const logPath = path.join(karlDir, 'logs', 'responses.jsonl');
  await appendFile(logPath, JSON.stringify(data) + '\n');
}
```

**Commands:**
- `karl list` - Show recent responses
- `karl show @<id>` - Display specific response

### Phase 2: Referencing & Chains

**Milestone:** Can reference previous responses

```typescript
// src/logging/reference.ts
async function resolveReference(ref: string): Promise<ResponseLog> {
  // Parse @last, @-N, @<id>, @tag:name
  // Query logs/index.db
  // Return matched response
}

async function buildChain(id: string): Promise<ResponseLog[]> {
  // Walk parent links
  // Return ordered chain
}
```

**Commands:**
- `karl reply @last "continue"` - Chain responses
- `karl chain @<id>` - Show conversation chain
- `--parent @<id>` flag for manual parent setting

### Phase 3: Indexing & Search

**Milestone:** Fast queries over large logs

```sql
-- index.db schema
CREATE TABLE responses (
  id TEXT PRIMARY KEY,
  timestamp INTEGER,
  command TEXT,
  prompt TEXT,
  stack TEXT,
  parent TEXT,
  exit_code INTEGER,
  log_offset INTEGER,  -- byte offset in .jsonl
  session_id TEXT,
  FOREIGN KEY (parent) REFERENCES responses(id)
);

CREATE TABLE tags (
  response_id TEXT,
  tag TEXT,
  FOREIGN KEY (response_id) REFERENCES responses(id)
);

CREATE INDEX idx_timestamp ON responses(timestamp);
CREATE INDEX idx_parent ON responses(parent);
CREATE INDEX idx_session ON responses(session_id);
CREATE INDEX idx_tags ON tags(tag);
```

**Commands:**
- `karl list --tag <tag>` - Filter by tag
- `karl list --since <time>` - Time-based queries
- `karl search <text>` - Full-text search in prompts/responses

### Phase 4: Advanced Features

**Milestone:** Diff, replay, sessions

```typescript
// src/logging/replay.ts
async function replayResponse(id: string, options: ReplayOptions) {
  const log = await resolveReference(id);
  const command = rebuildCommand(log, options);
  return executeCommand(command);
}

// src/logging/diff.ts
async function diffResponses(id1: string, id2: string) {
  const [log1, log2] = await Promise.all([
    resolveReference(id1),
    resolveReference(id2)
  ]);
  
  // Diff modified files
  // Diff response text
  // Show token/cost differences
}

// src/logging/session.ts
function detectSessions(logs: ResponseLog[]): Session[] {
  // Group by time gaps (30min threshold)
  // Or explicit session tags
}
```

**Commands:**
- `karl replay @<id>` - Re-run previous command
- `karl diff @<id1> @<id2>` - Compare responses
- `karl sessions` - List sessions
- `karl export @session:current` - Export session

### Phase 5: Privacy & Maintenance

**Milestone:** Production-ready logging

```typescript
// src/logging/privacy.ts
function redactSensitive(text: string, patterns: RegExp[]): string {
  // Apply redaction patterns
  // Replace with [REDACTED:API_KEY], etc.
}

// src/logging/rotation.ts
async function rotateLogsIfNeeded() {
  // Check if current month changed
  // Move old logs to dated file
  // Rebuild index
}

async function archiveLogs(olderThan: Date) {
  // Compress old logs
  // Move to archives/
  // Optionally delete raw logs
}
```

**Commands:**
- `karl logs rotate` - Manual rotation
- `karl logs prune --older-than 90d` - Delete old logs
- `karl logs redact --dry-run` - Test redaction
- `karl config set logs.encrypt true` - Enable encryption

---

## Configuration

```toml
# ~/.karl/config.toml

[logs]
# Enable/disable logging
enabled = true

# Log file path (default: ~/.karl/logs/responses.jsonl)
path = "~/.karl/logs/responses.jsonl"

# Rotation strategy
rotate = "monthly"  # daily, weekly, monthly, size
max_size_mb = 100   # for size-based rotation

# Retention
archive_after_days = 90
delete_after_days = 365
keep_tagged = true  # Never delete tagged responses

# Privacy
encrypt = false
gpg_key = ""
redact_patterns = [
  'sk-[a-zA-Z0-9]{32}',
  '\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b',
]
log_cloud_responses = true
log_local_responses = true

# Sessions
session_gap_minutes = 30
auto_tag_sessions = true

# Performance
index_enabled = true
index_path = "~/.karl/logs/index.db"
```

---

## Future Extensions

### Collaborative Logs

```bash
# Share logs with team
karl logs share @session:current --team engineering

# Subscribe to teammate's logs
karl logs subscribe alice@example.com --tag shared

# Reference teammate's responses
karl reply @alice:ace_501a "build on Alice's approach"
```

### AI-Powered Log Analysis

```bash
# Analyze patterns in your logs
karl logs analyze --find-inefficiencies

# Suggest improvements
karl logs analyze --suggest-better-prompts

# Find similar past solutions
karl logs similar "implement rate limiting"
# → Found similar: @ace_202b (85% match)
```

### Log-Based Testing

```bash
# Use logs as test fixtures
karl test --replay-session @session:-1

# Regression testing
karl test --replay-all-tagged regression

# Generate test cases from logs
karl logs generate-tests @tag:feature:auth > tests/auth.test.ts
```

---

## Summary

Chat via logging transforms Karl from a one-shot tool into a **conversational workspace** while maintaining Unix philosophy:

✅ **Stateless:** No hidden state files, just append-only logs  
✅ **Composable:** Pipe, filter, and chain like git  
✅ **Transparent:** All history is readable JSON  
✅ **Flexible:** Fork, branch, and merge conversations  
✅ **Private:** Encryption, redaction, selective logging  
✅ **Fast:** SQLite index for instant queries  

**The Result:** Feels like chat, works like git, stays true to Karl's serve-and-volley roots. 🎾
