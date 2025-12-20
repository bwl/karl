# Verbose Mode UX Design

## Philosophy

Verbose mode should feel like watching a **master craftsman at work** - each action deliberate, each output meaningful. Not a flood of debug logs, but a **rhythmic, legible stream** of thought → action → result.

Think: terminal as a **performance space**, not a log dump.

---

## Current Problems

### 💥 Common Verbose Mode Failures

1. **Wall of Text Syndrome**
   - Everything runs together
   - No visual hierarchy
   - Can't distinguish signal from noise
   - Eye fatigue sets in after 10 seconds

2. **Timestamp Overload**
   ```
   [2024-01-15 14:32:11.234] INFO: Starting process
   [2024-01-15 14:32:11.235] DEBUG: Loading config
   [2024-01-15 14:32:11.236] DEBUG: Config loaded
   [2024-01-15 14:32:11.237] INFO: Process started
   ```
   → Nobody needs millisecond precision for development tools

3. **Unclear Tool Calls**
   ```
   Calling: bash {"command": "ls -la /some/path"}
   Result: { success: true, stdout: "..." }
   ```
   → Looks like JSON dumps, not human communication

4. **Lost Context**
   - Output scrolls by too fast
   - Can't tell what phase we're in
   - Multiple parallel operations blur together

5. **No Emotional Pacing**
   - Everything has same urgency
   - No breathing room
   - No celebration of completion
   - Feels robotic

---

## Design Principles

### 1. **Rhythm & Pacing**

Output should have a **visual cadence** - fast for simple actions, slower for important results.

```
Thinking...
  ↳ Need to check file structure

Reading src/index.ts ━━━━━━━━━━━━━━━━━━━━━ 2.4 KB

Found:
  • 3 exported functions
  • 2 interfaces
  • 1 type alias
```

**Timing strategies:**
- Brief pause before major sections (50-100ms)
- Instant feedback for tool calls (<10ms)
- Slower reveal for large results (streaming)
- Quick confirmation ticks for success

### 2. **Semantic Grouping**

Different mental operations need different visual treatments:

#### 🧠 **Thoughts** (Planning, Analysis)
```
Analyzing request...
  • Need database schema
  • Should check existing migrations
  • Will generate SQL based on template
```

#### 🔧 **Actions** (Tool Calls, Commands)
```
$ git log --oneline -n 5

Running...
```

#### ✅ **Results** (Outcomes, Data)
```
Found 5 commits:

  a3f4b2c  feat: add user authentication
  91e8d7f  fix: resolve CORS issues
  ...
```

#### 💭 **Reasoning** (Why, not just what)
```
Decision: Using TypeScript strict mode
Reason: Existing codebase already has strict checks enabled
```

---

## Visual Language

### Color Scheme

**Semantic Colors** (not just pretty):

| Element | Color | Meaning |
|---------|-------|---------|
| Thoughts | Dim/Gray | Internal process, low urgency |
| Commands | Cyan/Blue | External action, medium focus |
| Success | Green | Positive outcome, confirmation |
| Data | White/Default | Neutral information |
| Warnings | Yellow | Attention needed |
| Errors | Red | Problem encountered |
| Headers | Bold White | Section breaks |
| Metadata | Dim | Supplementary info |

**Example palette:**
```
# Thoughts
\x1b[2m  ↳ Considering approach...\x1b[0m

# Actions  
\x1b[36m$ npm install\x1b[0m

# Success
\x1b[32m✓\x1b[0m Package installed

# Data (default terminal color)
Found 3 dependencies

# Metadata
\x1b[2m(142ms)\x1b[0m
```

### Typography Hierarchy

```
═══════════════════════════════════════
         PHASE: ANALYSIS
═══════════════════════════════════════

Section Header
──────────────

  Subsection (indented)
  
    • List item
    • List item
    
      → Nested detail
      → Nested detail

  Result block:
  ┌─────────────────────────────────────
  │ Content with clear boundaries
  │ Multiple lines visible
  └─────────────────────────────────────
```

**Indent Levels:**
- 0 spaces: Major headers
- 2 spaces: Section content
- 4 spaces: Details/lists
- 6 spaces: Nested data

---

## Progressive Disclosure

Show **just enough** at each moment, with ability to see more.

### Pattern: Summary → Details on Demand

**Default (terse):**
```
Reading config.json ✓
```

**Verbose (-v):**
```
Reading config.json
  ↳ Found in ./config.json (1.2 KB)
  ✓ Parsed successfully
```

**Very Verbose (-vv):**
```
Reading config.json
  Path: /home/user/project/config.json
  Size: 1,247 bytes
  Modified: 2 hours ago
  
  Content preview:
  ┌─────────────────────────────────────
  │ {
  │   "name": "my-project",
  │   "version": "1.0.0",
  │   ...
  └─────────────────────────────────────
  
  ✓ Parsed successfully (3ms)
```

### Pattern: Streaming with Checkpoints

For long operations, show progress **milestones**:

```
Installing dependencies...

  ✓ Resolved package tree (1.2s)
  
  Downloading packages...
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  47/120
  
    • lodash@4.17.21
    • express@4.18.2
    • typescript@5.0.0
    ...
```

---

## Unicode Decorations (Purposeful)

Use symbols to **encode meaning**, not just aesthetics.

### Functional Symbols

| Symbol | Meaning | Usage |
|--------|---------|-------|
| `↳` | Continuation/causation | "Because of X, doing Y" |
| `→` | Transformation/flow | "Input → Output" |
| `•` | List item (equal weight) | Unordered items |
| `▸` | Expandable/more | "See details" |
| `✓` | Success/complete | Confirmation |
| `✗` | Failure/error | Problem |
| `⚠` | Warning/caution | Attention needed |
| `⏳` | In progress | Long operation |
| `━` | Progress bar fill | Visual progress |
| `┃` | Connection/relation | Hierarchical link |
| `╰─` | Tree branch end | Final child |
| `├─` | Tree branch mid | Non-final child |

### Anti-Patterns (Avoid These)

❌ Emoji spam: `🚀 Starting 🔥 process 💯`  
❌ Box drawing overload: `╔═══╗` everywhere  
❌ Animated spinners that break scrollback  
❌ ASCII art logos in every output  

✅ Use symbols **consistently** for same meanings  
✅ Keep it **functional** - helps scanning  
✅ Work in **any terminal** (stick to common Unicode)

---

## Collapsible Sections Concept

Terminals don't support native collapse, but we can **simulate** with visual patterns.

### Technique 1: Summary Line + Details

```
▸ Full test output (23 lines) - expand with --full

▾ Full test output (23 lines):
  
  TAP version 13
  1..23
  ok 1 - should create user
  ok 2 - should validate email
  ...
```

**How it works:**
- Default: Show summary with expand hint
- With flag: Show full output with collapse indicator
- User learns the pattern quickly

### Technique 2: Log File Reference

```
Running build...

  ✓ Compiled 47 files
  ⚠ 3 warnings
  
  Full output: .karl/logs/build-2024-01-15-143022.log
  View: karl logs build
```

**Benefits:**
- Keeps terminal clean
- Full detail available on demand
- Persistent across sessions

### Technique 3: Contextual Truncation

```
Reading large file (2.4 MB)...

  First 10 lines:
  ┌─────────────────────────────────────
  │ import { defineConfig } from 'vite'
  │ import react from '@vitejs/plugin-react'
  │ ...
  └─────────────────────────────────────
  
  ... (2,341 more lines)
  
  Last 5 lines:
  ┌─────────────────────────────────────
  │   }
  │ })
  └─────────────────────────────────────
```

---

## Example Mockups

### Example 1: File Read Operation

**Terse mode (default):**
```
✓ Read src/index.ts
```

**Verbose mode (-v):**
```
Reading src/index.ts
  ↳ 2.4 KB, modified 1 hour ago
  ✓ Read successfully
```

**Debug mode (-vv):**
```
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
┃ READ FILE
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Path: /home/user/project/src/index.ts
  Size: 2,417 bytes
  Modified: 2024-01-15 13:22:14 (1 hour ago)
  Encoding: utf-8
  
  Stats:
  • Lines: 87
  • Characters: 2,417
  • Estimated tokens: ~600
  
  Content preview (first 5 lines):
  ┌─────────────────────────────────────
  │ import { serve } from 'bun'
  │ import { router } from './router'
  │ 
  │ const port = process.env.PORT || 3000
  │ 
  └─────────────────────────────────────
  
  ✓ Read successfully (2ms)
```

---

### Example 2: Bash Command Execution

**Terse:**
```
$ npm test
✓ All tests passed
```

**Verbose:**
```
Running command
  $ npm test

Output:
  ┌─────────────────────────────────────
  │ > project@1.0.0 test
  │ > vitest run
  │ 
  │  ✓ src/utils.test.ts (3)
  │  ✓ src/api.test.ts (5)
  │ 
  │  Tests: 8 passed (8)
  └─────────────────────────────────────

  ✓ Exit code: 0 (142ms)
```

**Debug:**
```
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
┃ BASH COMMAND
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Command: npm test
  Working directory: /home/user/project
  Environment: (inherited)
  Shell: /bin/bash
  Timeout: 30s

  Starting process... (pid: 12345)
  
  ┌─ STDOUT ─────────────────────────────
  │ > project@1.0.0 test
  │ > vitest run
  │ 
  │  ✓ src/utils.test.ts (3) 12ms
  │  ✓ src/api.test.ts (5) 34ms
  │ 
  │  Tests: 8 passed (8)
  │  Duration: 142ms
  └──────────────────────────────────────
  
  ┌─ STDERR ─────────────────────────────
  │ (empty)
  └──────────────────────────────────────
  
  Process metrics:
  • CPU time: 0.3s
  • Memory: 45 MB peak
  • Exit code: 0
  
  ✓ Command completed (142ms)
```

---

### Example 3: Multi-Step Task (The Real Challenge)

**Scenario:** User asks "Analyze the codebase and suggest improvements"

**Verbose output flow:**

```
═══════════════════════════════════════
  TASK: Analyze Codebase
═══════════════════════════════════════

Phase 1: Discovery
──────────────────

  Finding relevant files...
  
  $ find src -name "*.ts" -type f
  
  Found 23 TypeScript files:
  • src/index.ts
  • src/router.ts
  • src/utils.ts
  ...
  
  ✓ Discovery complete (89ms)


Phase 2: Analysis
─────────────────

  Reading source files...
  
  ┌─ src/index.ts ──────────────────────
  │ 2.4 KB • 87 lines
  │ ✓ Read
  └─────────────────────────────────────
  
  ┌─ src/router.ts ─────────────────────
  │ 5.1 KB • 142 lines
  │ ✓ Read
  └─────────────────────────────────────
  
  (21 more files...)
  
  Total read: 47.3 KB (23 files)
  
  ✓ Analysis complete (234ms)


Phase 3: Reasoning
──────────────────

  Thinking about improvements...
  
  Observations:
  • No TypeScript strict mode enabled
  • Inconsistent error handling patterns
  • Missing input validation in API routes
  • No logging framework in use
  
  Prioritizing by impact...
  ↳ High: Type safety (prevent bugs)
  ↳ Medium: Error handling (reliability)
  ↳ Low: Logging (observability)


Phase 4: Recommendations
────────────────────────

  ✓ Analysis complete!
  
  Found 4 improvement opportunities
  
  View full report: karl logs analysis

═══════════════════════════════════════
  COMPLETE (847ms)
═══════════════════════════════════════
```

**Key UX elements in this flow:**

1. **Clear phase separation** - User knows where we are
2. **Progress indicators** - Visual feedback during long operations
3. **Summarization** - "21 more files" not full dump
4. **Semantic grouping** - Observations vs priorities
5. **Breathing room** - Empty lines between phases
6. **Time awareness** - Duration shown for slow operations
7. **Next actions** - "View full report" suggests what to do

---

## Streaming Elegance

### The Challenge

Real-time output can be **chaotic**. How to stream without losing structure?

### Solution: Structured Streaming

**Bad streaming:**
```
ThinkingabouttheReading file
src/indexFound 3 functi
onsAnalyzingDone
```

**Good streaming:**

```
Thinking about the problem...
  ↳ Need to check file structure

Reading src/index.ts...
  ↳ 2.4 KB

Analyzing content...
  • Found 3 functions
  • Found 2 interfaces
  
✓ Complete
```

**How it works:**

1. **Line buffering** - Only stream complete lines
2. **Section blocks** - Group related output
3. **Progressive reveal** - Show structure first, content second
4. **Cursor management** - Use `\r` for progress bars, `\n` for logs

### Streaming Patterns

**Pattern: Build-up then reveal**
```
Loading dependencies...
  • react
  • typescript
  • vite
  [list grows line by line as streaming happens]
  
✓ Loaded 47 packages
```

**Pattern: Status line updates**
```
Processing files... 1/23
Processing files... 2/23
Processing files... 3/23
...
[same line updates with \r]

✓ Processed 23 files
```

**Pattern: Thought stream**
```
Analyzing...

  Checking types...
  ↳ All types valid
  
  Checking imports...
  ↳ Found circular dependency
  
  Suggesting fix...
  ↳ Can extract shared types
  
✓ Analysis complete
```

---

## Terminal Width Awareness

### Responsive Output

Different terminal widths need different layouts.

**Narrow terminal (80 cols):**
```
Reading file...
  src/components/
    Button.tsx
  ✓ Read (2.3 KB)
```

**Wide terminal (120+ cols):**
```
Reading file...
  src/components/Button.tsx ────────────────────────────── ✓ 2.3 KB (12ms)
```

**Detection:**
```typescript
const width = process.stdout.columns || 80
const canUseLongFormat = width >= 100
```

### Layout Strategies

1. **Stack on narrow, inline on wide**
2. **Truncate paths** on narrow
3. **Expand abbreviations** on wide
4. **Multi-column** only on wide

---

## Performance Considerations

### Don't Let Pretty Slow You Down

**Fast paths:**
- ✅ Simple string concatenation
- ✅ Template literals
- ✅ Direct stdout.write()

**Slow paths:**
- ❌ Complex Unicode rendering per-line
- ❌ Color calculation in tight loops  
- ❌ Async delays for "animation"

### Buffering Strategy

```typescript
// Good: Batch writes
const buffer: string[] = []
buffer.push(line1)
buffer.push(line2)
buffer.push(line3)
process.stdout.write(buffer.join('\n') + '\n')

// Bad: Individual writes
process.stdout.write(line1 + '\n')
process.stdout.write(line2 + '\n')
process.stdout.write(line3 + '\n')
```

---

## Implementation Checklist

### Core Features

- [ ] Verbosity levels: `-v`, `-vv`, `-vvv`
- [ ] Color theme system (customizable)
- [ ] Terminal width detection
- [ ] Smart truncation/expansion
- [ ] Tool call formatters
- [ ] Section/phase separators
- [ ] Progress indicators
- [ ] Streaming line buffer
- [ ] Duration tracking
- [ ] Log file integration

### Polish Features

- [ ] Timing statistics (--timing flag)
- [ ] Token counting in verbose mode
- [ ] Cost estimation display
- [ ] Collapsible sections via flags
- [ ] Export output as markdown
- [ ] Syntax highlighting for code blocks
- [ ] Diff display for file edits
- [ ] Tree view for file structures

---

## Testing Verbose Output

### Manual Tests

1. **Rapid fire** - Run same command 10x, ensure consistent format
2. **Width test** - Resize terminal during operation
3. **Color test** - Check NO_COLOR env var respected
4. **Pipe test** - Pipe to `less`, ensure readable
5. **Speed test** - 100 operations, should feel instant

### Readability Metrics

- **Scan time** - Can you find key info in <2 seconds?
- **Eye fatigue** - Can you watch it for 60 seconds without strain?
- **Comprehension** - Can someone unfamiliar understand what's happening?

---

## Inspiration & References

### Well-Designed CLI Tools

- **cargo** - Rust's package manager (great progress bars)
- **pnpm** - Fast npm client (clean hierarchical output)
- **vercel** - Deployment tool (elegant status updates)
- **turbo** - Build system (beautiful parallel task output)
- **gh** - GitHub CLI (minimal, semantic colors)

### Design Patterns

- **The Missing Semester** - Terminal UX principles
- **ANSI escape codes** - Color and cursor control
- **Unicode box drawing** - Structural elements
- **Semantic versioning for verbosity** - -v/-vv/-vvv convention

---

## The Karl Personality

Verbose mode is where **Karl's character shines**.

Think of the output as Karl explaining his thought process:

```
Alright, let's analyze this codebase...

  First, I need to see what files we're working with.
  
  $ find src -name "*.ts"
  
  Got 23 TypeScript files. Not too bad.
  
  Now reading through them...
  ✓ src/index.ts (2.4 KB)
  ✓ src/router.ts (5.1 KB)
  ...
  
  Interesting - I'm seeing a lot of error handling
  but no consistent pattern. Let me think about this...
  
  Here's what I'd suggest:
  • Standardize on a Result type
  • Add proper error boundaries
  • Consider using a logging library
  
Done! Want me to elaborate on any of these?
```

**Tone:**
- Professional but conversational
- Explains the "why" not just "what"
- Admits when uncertain
- Shows work, doesn't just announce results

---

## Final Thoughts

**Verbose mode should be a feature, not a debug tool.**

When done right:
- Users **choose** to run with `-v` because it's enjoyable
- Output is **educational** - teaches how Karl thinks
- Serves as **documentation** - shows what's possible
- Builds **trust** - nothing hidden, everything explained

**The goal:** Make verbose mode so good that people redirect it to a file and **read it later as documentation**.

```bash
karl -v "analyze codebase" > analysis.log

# Later...
less analysis.log  # Actually readable and useful!
```

That's the standard we're shooting for. 🎾
