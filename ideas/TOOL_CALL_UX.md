# Tool Call UX Design for Karl

*"Like watching Karlović serve: fast, precise, informative — not overwhelming."*

---

## The Problem

### Current Verbose Mode Issues

**Too Much Information**
```
[2024-12-20 14:32:18] Tool call initiated
[2024-12-20 14:32:18] Tool: read_file
[2024-12-20 14:32:18] Parameters: {"path": "/Users/dev/project/src/utils/helper.ts", "encoding": "utf-8"}
[2024-12-20 14:32:18] Executing tool call...
[2024-12-20 14:32:18] Tool call successful
[2024-12-20 14:32:18] Response size: 2847 bytes
[2024-12-20 14:32:18] Duration: 12ms
```

**Problems:**
- ❌ Timestamps on every line create visual noise
- ❌ JSON parameter dumps are hard to scan
- ❌ Success/failure buried in walls of text
- ❌ No visual hierarchy (everything looks the same)
- ❌ Hard to correlate tool calls with results
- ❌ Performance info disconnected from context
- ❌ Long file paths push useful info off-screen

### What Developers Actually Need

1. **At a glance**: What tool, what file/command, did it work?
2. **On demand**: Full parameters, timing, output details
3. **Context**: How does this fit in the workflow?
4. **Performance**: Is it slow? Should I optimize?
5. **Debugging**: When it fails, show me everything

---

## Design Principles

### 1. Progressive Disclosure
Show minimal info by default, expand on demand.

### 2. Visual Hierarchy
Use symbols, color, and spacing to create scannable output.

### 3. Contextual Relevance
Show more detail for errors, less for routine operations.

### 4. Performance Awareness
Make slow operations visible without cluttering fast ones.

### 5. Tennis Philosophy
Tool calls are "shots" in the game. Make them feel dynamic and purposeful.

---

## Icon Vocabulary

### Tool Symbols (Unicode)
```
📖  read    - Reading files
✏️   edit    - Editing files  
⚡  bash    - Running commands
✍️   write   - Creating/overwriting files
```

### Status Indicators
```
✓  Success (green)
✗  Error (red)
⟳  In progress (cyan, animated)
⚠  Warning (yellow)
⏱  Slow operation (>500ms)
```

### File Type Indicators
```
📄  Generic file
📦  Package/config (package.json, tsconfig.json)
🎨  Style files (.css, .scss)
⚙️   Config files (.env, .yaml)
📊  Data files (.json, .csv)
🔧  Build files (Makefile, build scripts)
```

### Size Indicators
```
·   Tiny (<1KB)
•   Small (1-10KB)
◆   Medium (10-100KB)
◉   Large (100KB-1MB)
●   Huge (>1MB)
```

---

## Color Coding

### By Tool Type
```
read    → Blue (🔵)    - Informational, passive
write   → Magenta (🟣) - Creative, additive
edit    → Yellow (🟡)  - Transformative, careful
bash    → Green (🟢)   - Active, executable
```

### By Status
```
Success → Green (✓)
Error   → Red (✗)
Warning → Yellow (⚠)
Info    → Cyan (ℹ)
```

### By Performance
```
Fast    → Dim/gray (0-100ms)
Normal  → Default (100-500ms)
Slow    → Yellow (500-2000ms)
Very Slow → Red (>2000ms)
```

---

## Output Modes

### Summary Mode (Default)

**Philosophy**: One line per tool call, scannable at 60mph.

```
📖 auth.ts (◆ 47KB) ✓ 12ms
⚡ npm test ✓ 1.2s
✏️  config.ts:23 ✓ 8ms
✍️  new-file.ts (• 3KB) ✓ 5ms
```

**Anatomy**:
```
[icon] [target] [size/line] [status] [timing]
```

**Benefits**:
- One line = one action
- Color-coded by tool type
- Timing shows performance issues
- File sizes give context
- Status is immediate

### Detail Mode (--verbose)

**Philosophy**: Show everything, but organized.

```
📖 read · src/auth/middleware.ts
   ├─ Size: 47KB (2,847 lines)
   ├─ Encoding: utf-8
   └─ Time: 12ms ✓

⚡ bash · npm test
   ├─ Working dir: /Users/dev/project
   ├─ Exit code: 0 ✓
   ├─ Time: 1.2s
   └─ Output:
      │ PASS src/auth.test.ts
      │ PASS src/utils.test.ts
      │ Tests: 42 passed, 42 total
      │ Time: 1.123s

✏️  edit · src/config.ts:23
   ├─ Changed: 3 lines
   ├─ Old: const timeout = 5000;
   ├─ New: const timeout = 30000;
   └─ Time: 8ms ✓

✍️  write · src/types/new-file.ts
   ├─ Size: 3KB (87 lines)
   ├─ Status: Created ✓
   └─ Time: 5ms
```

**Benefits**:
- Tree structure shows relationships
- Still one primary line per tool
- Details indented and organized
- Output clearly separated
- Easy to scan vertically

### Trace Mode (--trace)

**Philosophy**: Full debugging, everything including the kitchen sink.

```
📖 read · src/auth/middleware.ts
   ┌─ Request
   │  Model: claude-3-5-sonnet-20241022
   │  Timestamp: 2024-12-20T14:32:18.742Z
   │  Call ID: tool_01AbC123
   │
   ├─ Parameters
   │  {
   │    "path": "src/auth/middleware.ts",
   │    "encoding": "utf-8",
   │    "offset": 0
   │  }
   │
   ├─ Execution
   │  Started: 14:32:18.743
   │  Ended: 14:32:18.755
   │  Duration: 12ms
   │  Status: Success ✓
   │
   └─ Response
      Size: 47,329 bytes
      Lines: 2,847
      Hash: a3f9c2e1
      Cached: false
```

### Error Mode (Automatic)

**Philosophy**: When things break, show everything automatically.

```
✗ bash · npm build
   ├─ Exit code: 1
   ├─ Duration: 847ms
   ├─ Working dir: /Users/dev/project
   │
   ├─ stderr:
   │  │ ERROR in src/index.ts:47:12
   │  │ TS2339: Property 'foo' does not exist on type 'Bar'
   │  │    45 | const bar = new Bar();
   │  │    46 | 
   │  │ >  47 | console.log(bar.foo);
   │  │       |             ^
   │  │    48 |
   │
   └─ Suggestion:
      Check type definition for Bar in src/types/bar.ts
      
      Recent changes to Bar:
      📖 src/types/bar.ts (modified 3 min ago)
```

---

## File Path Rendering

### The Problem
```
❌ /Users/developer/projects/company/myapp/packages/karl/src/utils/helpers/string-utils.ts
```

Too long! Pushes everything else off screen.

### Solutions

#### 1. Smart Truncation
Show meaningful parts, elide the middle:

```
✓ …/karl/src/utils/helpers/string-utils.ts
✓ …/packages/karl/src/utils/helpers/string-utils.ts (from project root)
✓ string-utils.ts (with hover/expand)
```

#### 2. Relative Paths
Always relative to CWD or project root:

```
✓ src/utils/helpers/string-utils.ts
✓ packages/karl/src/runner.ts
```

#### 3. Smart Grouping
When multiple files in same directory:

```
📖 src/auth/
   ├─ middleware.ts (◆ 47KB) ✓
   ├─ handlers.ts (• 12KB) ✓
   └─ types.ts (• 8KB) ✓
```

#### 4. Icon-based Context
Use file type icons to communicate location type:

```
📦 package.json (root)
⚙️  .env.local (root)
📄 src/index.ts
🔧 scripts/build.sh
```

#### 5. Line Number References
For edits, show location clearly:

```
✏️  config.ts:23 (auth section)
✏️  runner.ts:145-178 (executeTask function)
```

---

## Progressive Disclosure

### Interaction Models

#### Option 1: Expandable Sections (Interactive TUI)
```
📖 middleware.ts ✓ 12ms [press 'e' to expand]

[User presses 'e']

📖 read · src/auth/middleware.ts
   ├─ Size: 47KB (2,847 lines)
   ├─ Encoding: utf-8
   └─ Time: 12ms ✓
```

#### Option 2: Hoverable (If terminal supports it)
```
📖 middleware.ts ✓ 12ms
    ↓
[Hover shows tooltip]
┌──────────────────────────────┐
│ src/auth/middleware.ts       │
│ Size: 47KB                   │
│ Lines: 2,847                 │
│ Modified: 3 min ago          │
└──────────────────────────────┘
```

#### Option 3: Collapsible Log Format
```
▶ 📖 middleware.ts ✓ 12ms

[Click/toggle to expand]

▼ 📖 middleware.ts ✓ 12ms
  ├─ Path: src/auth/middleware.ts
  ├─ Size: 47KB
  └─ Time: 12ms
```

#### Option 4: Reference Numbers
```
[1] 📖 middleware.ts ✓ 12ms
[2] ⚡ npm test ✓ 1.2s
[3] ✏️  config.ts:23 ✓ 8ms

Use 'karl explain 2' to see details of call [2]
```

---

## Timing & Performance

### Performance Budget Display

Show cumulative time for tool categories:

```
⏱ Tool Performance
   📖 read:  145ms (5 calls)
   ✏️  edit:   73ms (3 calls)
   ⚡ bash: 3.2s (2 calls)
   ✍️  write:  12ms (1 call)
   ─────────────────────
   Total:  3.43s
```

### Slow Operation Warnings

Automatic detail for slow operations:

```
⚡ npm install ⚠ 12.3s (slow)
   ├─ Expected: ~3s
   ├─ Network: 8.1s (66%)
   ├─ Install: 3.2s (26%)
   └─ Scripts: 1.0s (8%)
   
   Suggestion: Use npm ci for faster installs
```

### Parallel Tool Calls

Show concurrent operations clearly:

```
⟳ Running 3 tools in parallel...

║ [1] 📖 auth.ts        ✓ 145ms
║ [2] 📖 config.ts      ✓ 203ms
║ [3] 📖 middleware.ts  ✓ 187ms

⏱ Parallel execution: 203ms (saved ~335ms)
```

---

## Example Mockups

### Scenario 1: Simple Read Operation

**Summary Mode**:
```
📖 auth.ts ✓ 12ms
```

**Verbose Mode**:
```
📖 read · src/auth.ts
   ├─ Size: 47KB
   └─ Time: 12ms ✓
```

**Trace Mode**:
```
📖 read · src/auth.ts
   ├─ Call ID: tool_01AbC123
   ├─ Path: /Users/dev/project/src/auth.ts
   ├─ Size: 47,329 bytes (2,847 lines)
   ├─ Encoding: utf-8
   ├─ Modified: 2024-12-20 14:30:15
   ├─ Time: 12ms
   └─ Hash: a3f9c2e1 ✓
```

### Scenario 2: Edit with Diff

**Summary Mode**:
```
✏️  config.ts:23 ✓ 8ms
```

**Verbose Mode**:
```
✏️  edit · src/config.ts:23
   ├─ Changed: timeout value
   ├─ Diff:
   │  -  const timeout = 5000;
   │  +  const timeout = 30000;
   └─ Time: 8ms ✓
```

**Trace Mode**:
```
✏️  edit · src/config.ts:23
   ├─ Call ID: tool_02XyZ456
   ├─ Location: line 23 (exports section)
   ├─ Search pattern: "const timeout = 5000;"
   ├─ Replacement: "const timeout = 30000;"
   ├─ Match: Exact (1 occurrence)
   │
   ├─ Context (3 lines):
   │  21 | export const config = {
   │  22 |   port: 3000,
   │  23 |   const timeout = 5000;
   │  24 |   retry: 3,
   │  25 | };
   │
   ├─ Preview:
   │  21 | export const config = {
   │  22 |   port: 3000,
   │  23 |   const timeout = 30000;
   │  24 |   retry: 3,
   │  25 | };
   │
   └─ Time: 8ms ✓
```

### Scenario 3: Bash with Output

**Summary Mode**:
```
⚡ npm test ✓ 1.2s
```

**Verbose Mode**:
```
⚡ bash · npm test
   ├─ Exit: 0 ✓
   ├─ Time: 1.2s
   └─ Output:
      │ PASS src/auth.test.ts
      │ PASS src/utils.test.ts
      │ Tests: 42 passed, 42 total
```

**Trace Mode**:
```
⚡ bash · npm test
   ├─ Call ID: tool_03DeF789
   ├─ Command: npm test
   ├─ Working dir: /Users/dev/project
   ├─ Environment: (12 vars)
   │  NODE_ENV=test
   │  CI=false
   │  ...
   │
   ├─ Execution:
   │  Started: 14:32:19.123
   │  Ended: 14:32:20.345
   │  Duration: 1,222ms
   │  Exit code: 0 ✓
   │
   ├─ stdout (847 bytes):
   │  │ PASS src/auth.test.ts
   │  │   ✓ validates JWT tokens (23ms)
   │  │   ✓ rejects invalid tokens (12ms)
   │  │
   │  │ PASS src/utils.test.ts
   │  │   ✓ formats dates correctly (5ms)
   │  │   ✓ handles edge cases (8ms)
   │  │
   │  │ Test Suites: 2 passed, 2 total
   │  │ Tests: 42 passed, 42 total
   │  │ Time: 1.123s
   │
   └─ stderr: (empty)
```

### Scenario 4: Failed Operation

**Auto-verbose on error**:
```
✗ bash · npm build
   ├─ Exit: 1
   ├─ Time: 847ms
   ├─ Working dir: /Users/dev/project
   │
   ├─ stderr:
   │  │ ERROR in src/index.ts:47:12
   │  │ TS2339: Property 'foo' does not exist on type 'Bar'
   │  │    45 | const bar = new Bar();
   │  │    46 | 
   │  │ >  47 | console.log(bar.foo);
   │  │       |             ^
   │  │    48 |
   │
   └─ Context:
      Last modified: src/types/bar.ts (3 min ago)
      Recent tool calls:
        ✏️  bar.ts:12 (removed foo property)
```

### Scenario 5: Multiple Related Operations

**Grouped summary**:
```
📖 Reading 5 files...
   ├─ auth.ts ✓ 12ms
   ├─ config.ts ✓ 8ms
   ├─ middleware.ts ✓ 15ms
   ├─ types.ts ✓ 5ms
   └─ utils.ts ✓ 9ms
   
⏱ Total: 49ms (parallel: 15ms)
```

### Scenario 6: Write New File

**Summary Mode**:
```
✍️  new-feature.ts (• 3KB) ✓ 5ms
```

**Verbose Mode**:
```
✍️  write · src/features/new-feature.ts
   ├─ Status: Created (new file) ✓
   ├─ Size: 3KB (87 lines)
   ├─ Content:
   │  │ export class NewFeature {
   │  │   constructor() { ... }
   │  │   async execute() { ... }
   │  │ }
   │  │ ... (84 more lines)
   └─ Time: 5ms
```

---

## Tennis-Themed Output

### The Serve (Task Start)
```
🎾 Serving task to claude-3-5-sonnet...
   Model: Sonnet 3.5
   Context: 47KB
   Skills: discover, architect
```

### The Volleys (Tool Calls)
```
⟳ Rally in progress...

  1️⃣  📖 auth.ts ✓ 12ms
  2️⃣  📖 config.ts ✓ 8ms
  3️⃣  ✏️  middleware.ts:45 ✓ 15ms

🎾 3 shots, 35ms
```

### The Ace (One-shot completion)
```
🎾 ACE! Task completed in one shot.
   
   📖 auth.ts ✓ 12ms
   ✏️  auth.ts:34 ✓ 8ms
   
⏱  Total: 20ms · No edits needed
```

### The Match Summary
```
🎾 Match Complete

   Service Stats:
   ├─ Model: claude-3-5-sonnet
   ├─ Duration: 3.4s
   ├─ Tools: 8 calls
   │  ├─ 📖 read: 5
   │  ├─ ✏️  edit: 2
   │  └─ ⚡ bash: 1
   ├─ Tokens: ~12K
   └─ Status: Success ✓
   
   Aces: 2 (one-shot completions)
   Rallies: 1 (multi-turn)
```

---

## Smart Defaults

### Context-Aware Verbosity

**Automatic detail levels based on context**:

```
Interactive terminal (TTY) → Summary mode
  - User is watching, keep it clean
  - Show errors verbosely
  - Slow operations get details

Piped output → Minimal mode
  - Machine parsing likely
  - Just facts, no formatting
  - One line per tool call

CI/CD environment → Structured mode
  - GitHub Actions, GitLab CI
  - Add annotations for errors
  - Group related operations
  
Error occurred → Auto-verbose for that call
  - Always show full context
  - Include suggestions
  - Show recent related calls
```

### Terminal Width Awareness

```typescript
// Adapt to terminal width
const width = process.stdout.columns || 80;

if (width < 80) {
  // Mobile/narrow: Ultra-compact
  // 📖 auth.ts ✓
  
} else if (width < 120) {
  // Standard: Summary mode
  // 📖 auth.ts (◆ 47KB) ✓ 12ms
  
} else {
  // Wide: Add extra context
  // 📖 src/auth.ts (◆ 47KB, modified 3m ago) ✓ 12ms
}
```

---

## Implementation Ideas

### 1. Streaming Display

Show tool calls as they happen, update in place:

```
⟳ 📖 auth.ts...
    ↓ (in-place update)
✓ 📖 auth.ts 12ms
```

### 2. Summary on Exit

During execution, show minimal. On completion, show summary:

```
[During work - clean, minimal]
⟳ Working...

[On exit - complete picture]
🎾 Task Complete

Tool Trace:
  1. 📖 auth.ts ✓ 12ms
  2. 📖 config.ts ✓ 8ms
  3. ✏️  auth.ts:34 ✓ 15ms
  4. ⚡ npm test ✓ 1.2s

Total: 1.24s · 4 tools · Success ✓
```

### 3. Collapsible Log Files

Write full trace to `.karl/logs/task-{id}.log`:

```bash
# Show summary live
karl run "add auth" 

# Review details later
karl trace last        # Show last task trace
karl trace task-123    # Show specific task
karl trace --tools     # Show just tool calls
```

### 4. Debug Command

Separate command for diving deep:

```bash
# Normal execution
karl run "task"

# Debug mode (shows everything)
karl debug "task"
```

---

## Configuration

### User Preferences

`.karl/config.json`:
```json
{
  "toolCalls": {
    "mode": "summary",           // summary | verbose | trace | minimal
    "showTiming": true,          // Always show timing
    "showSize": true,            // Show file sizes
    "slowThreshold": 500,        // Yellow warning at 500ms
    "groupRelated": true,        // Group calls to same directory
    "icons": true,               // Use Unicode icons
    "colors": true,              // Use color coding
    "autoExpand": {
      "errors": true,            // Auto-verbose on errors
      "slow": true,              // Auto-verbose if >2s
      "edits": false             // Auto-verbose on edits
    },
    "tennis": {
      "enabled": true,           // Tennis metaphors
      "aces": true,              // Celebrate one-shots
      "matchSummary": true       // Summary at end
    }
  }
}
```

### Environment Variables

```bash
KARL_TOOL_MODE=verbose karl run "task"
KARL_SHOW_TIMING=false karl run "task"
KARL_ICONS=false karl run "task"  # Plain text mode
```

### CLI Flags

```bash
karl run "task" --tool-mode=summary
karl run "task" --no-icons        # ASCII only
karl run "task" --no-color        # No ANSI colors
karl run "task" --trace           # Full trace mode
karl run "task" --tennis          # Tennis metaphors
```

---

## Accessibility

### Screen Reader Support

Provide plain text mode with clear structure:

```bash
karl run "task" --no-icons --no-color

Output:
READ auth.ts SUCCESS 12ms
BASH npm test SUCCESS 1.2s
EDIT config.ts:23 SUCCESS 8ms
```

### Reduced Motion

For users with motion sensitivity:

```bash
KARL_NO_ANIMATION=1 karl run "task"

# No spinners, no progress bars
# Just state changes
```

### Color Blind Support

Use shapes + colors + text:

```
✓ [SUCCESS] 📖 read auth.ts
✗ [ERROR] ⚡ bash npm build
⚠ [WARNING] slow operation
```

---

## Anti-Patterns to Avoid

### ❌ Don't Repeat Information
```
❌ [INFO] Reading file: auth.ts
   [INFO] File: auth.ts
   [INFO] Operation: read
   [INFO] Target: auth.ts
```

### ❌ Don't Bury the Lede
```
❌ Starting operation...
   Initializing file system access...
   Validating path...
   Reading file contents...
   Success! Read auth.ts (12ms)
```

### ❌ Don't Use Jargon
```
❌ tool_use block received
   Invoking read_file handler
   FSM transition: pending → executing
```

### ❌ Don't Show Technical IDs (unless tracing)
```
❌ [tool_01AbC123XyZ456] read file
```

### ❌ Don't Use Wall-of-Text Errors
```
❌ Error: ENOENT: no such file or directory, open '/Users/dev/project/src/auth.ts' at FSReqCallback.oncomplete (node:fs:188:3) at FSReqCallback...
```

---

## Best Practices

### ✅ Show Status First
```
✓ 📖 auth.ts 12ms
✗ ⚡ npm build 847ms
```

### ✅ Use Visual Hierarchy
```
📖 Reading 3 files...
   ├─ auth.ts ✓
   ├─ config.ts ✓
   └─ middleware.ts ✓
```

### ✅ Context for Errors
```
✗ bash · npm build
   
   Error: Module not found
   
   Recent changes:
   ✏️  package.json (removed lodash) 2 min ago
   
   Suggestion:
   npm install lodash
```

### ✅ Celebrate Success
```
🎾 ACE! One-shot completion.

   ✏️  auth.ts:34 ✓
   
   Your task is complete.
```

### ✅ Progressive Detail
```
# Default
✏️  config.ts:23 ✓

# --verbose
✏️  edit · src/config.ts:23
   ├─ Changed: timeout
   └─ 5000 → 30000 ✓

# --trace
✏️  edit · src/config.ts:23
   ├─ Call ID: tool_02XyZ456
   ├─ Pattern: "const timeout = 5000;"
   ├─ Replace: "const timeout = 30000;"
   ├─ Match: exact (1 occurrence)
   └─ Time: 8ms ✓
```

---

## Future Enhancements

### 1. Interactive Timeline
```
Timeline (press ← → to navigate):

14:32:18 ────●─────●─────────●────────────●─── 14:32:20
             │     │         │            │
             │     │         │            └─ ⚡ npm test (1.2s)
             │     │         └─ ✏️  config.ts:23
             │     └─ 📖 auth.ts
             └─ Task start
```

### 2. Dependency Visualization
```
Show which tool calls depend on others:

📖 auth.ts ✓
  └─> ✏️  auth.ts:34 ✓
       └─> ⚡ npm test ✓
```

### 3. Cost Tracking
```
⏱ Performance & Cost
   
   Time: 3.4s
   Tools: 8 calls
   API Tokens: ~12K
   Estimated cost: $0.003
```

### 4. Replay Mode
```bash
# Record a session
karl run "task" --record

# Replay with original timing
karl replay last

# Replay at 2x speed
karl replay last --speed=2
```

### 5. Diff Visualization
```
✏️  config.ts:23

   ╭─ Before ────────────────────╮
   │ const timeout = 5000;       │
   ╰─────────────────────────────╯
                ↓
   ╭─ After ─────────────────────╮
   │ const timeout = 30000;      │
   ╰─────────────────────────────╯
```

---

## Summary

**Core Philosophy**: Informed, not overwhelmed.

**Key Patterns**:
1. 📖✏️⚡✍️ – Clear, universal icons
2. One line per tool (summary mode)
3. Auto-expand errors and slow ops
4. Progressive disclosure (summary → verbose → trace)
5. Tennis metaphors for personality
6. Color + symbols + text for accessibility
7. Smart defaults based on context

**Golden Rule**: Show just enough to feel in control, hide nothing when debugging.

---

*"The ace serves truth in one line. The rally reveals wisdom in layers."*
