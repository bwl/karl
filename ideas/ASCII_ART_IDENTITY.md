# Karl's ASCII Art Visual Identity

> "13,728 aces. Zero rallies. Pure serve-and-volley dominance." — The Karl Philosophy

## Table of Contents
1. [Core Tennis Elements](#core-tennis-elements)
2. [Progress Indicators](#progress-indicators)
3. [Status Symbols Vocabulary](#status-symbols-vocabulary)
4. [Playful vs Corporate](#playful-vs-corporate)
5. [Output Mockups](#output-mockups)
6. [Animated Sequences](#animated-sequences)
7. [Decorative Elements](#decorative-elements)

---

## Core Tennis Elements

### Tennis Ball
```
    ___
   (   )
    \ /
     o
     
  or simple:
  
     ●
     o
     •
```

### Tennis Racket
```
   __/\__
  |      |
  |  /\  |
  |      |
   \____/
      |
      |
     / \

  or minimal:
  
    ○
    |
    |
```

### Tennis Net
```
╔═══════════════════════════════════════════╗
║  #  #  #  #  #  #  #  #  #  #  #  #  #  ║
║  #  #  #  #  #  #  #  #  #  #  #  #  #  ║
╚═══════════════════════════════════════════╝

  or simple divider:
  
  - - - - - - - - - - - - - - - - - - - - -
```

### Tennis Court (Top View)
```
┌─────────────────────────────────────┐
│                                     │
│ ┌───────────────────────────────┐   │
│ │                               │   │
│ │            ●                  │   │  ← ball in play
│ │                               │   │
│ └───────────────────────────────┘   │
│                                     │
└─────────────────────────────────────┘
```

### Scoreboard
```
╔══════════════════════════════════╗
║   KARL        │        TASK      ║
║   ████ ACE!   │         15       ║
╚══════════════════════════════════╝

  or minimal:
  
  ⚡ ACE  │  ❌ FAULT  │  ⏸ DEUCE
```

---

## Progress Indicators

### Ball Bounce Animation
```
Frame 1:  ●                    
          |                    
         ─┴─                   

Frame 2:   ●                   
          /                    
         ─┴─                   

Frame 3:    ●                  
           /                   
         ─┴─                   

Frame 4:     ●                 
            |                  
         ─┴─                   

Frame 5:    ●                  
           \                   
         ─┴─                   

Frame 6:   ●                   
          \                    
         ─┴─                   

Frame 7:  ●                    
          |                    
         ─┴─                   
```

**Usage:** Cycle through frames while waiting for API response.

### Serve Motion Spinner
```
Frame 1:   |  preparing...
Frame 2:   /  winding up...
Frame 3:   —  at the peak...
Frame 4:   \  contact!
Frame 5:   |  follow through...
Frame 6:   ●→ served!
```

### Loading Bar (Ball Crossing Court)
```
[●                              ] 10%
[=======●                       ] 30%
[===============●               ] 50%
[======================●        ] 75%
[==============================●] 100% ACE!
```

### Thinking Animation (Rally)
```
Frame 1:  karl ●→              opponent
Frame 2:  karl              ←● opponent  
Frame 3:  karl ●→              opponent
Frame 4:  karl              ←● opponent
Frame 5:  karl ●→ ACE!         opponent
```

### Service Line Progress
```
First Serve:  [████████████████████░░░░░░░░] 70%
Second Serve: [████████░░░░░░░░░░░░░░░░░░░░] 30%

or with ball:

├─────────────●──────────────────┤
│  SERVING... 47%                │
```

---

## Status Symbols Vocabulary

### Outcome Symbols
```
⚡ ACE       - Perfect completion (one-shot success)
✓ IN        - Task completed successfully
✗ OUT       - Task failed
⚠ LET       - Warning, retry allowed
● SERVING   - Task in progress
○ WAITING   - Queued task
⏸ DEUCE     - Tie/ambiguous state
🎾 RALLY    - Multiple attempts (avoid!)
▶ VOLLEY    - Parallel tasks in flight
```

### Model Status Icons
```
🏃 CLIFFY   - Fast/Haiku model active
🎯 SONNET   - Balanced model
🏆 OPUS     - Premium model
⚡ LOCAL    - Local model
🌐 REMOTE   - API model
```

### Tool Call Symbols
```
📖 read     - Reading file
✍️  write    - Writing file
✂️  edit     - Editing file
⚙️  bash     - Running command
```

### Skill Symbols
```
🧠 SKILL    - Skill loaded
📚 CONTEXT  - Context injected
🎓 EXPERT   - Advanced skill active
```

---

## Playful vs Corporate

### ❌ Corporate (Boring)
```
INFO: Processing request...
INFO: Executing task #1247
INFO: Task completed successfully
INFO: Exit code: 0
```

### ✅ Playful (Karl Style)
```
● Serving...
⚡ ACE! Task completed in one shot
   └─ Execution time: 1.2s
   └─ Token count: 420
   
Game, set, match! 🎾
```

### ❌ Corporate Error
```
ERROR: Task failed
ERROR CODE: ERR_INVALID_INPUT
Stack trace:
  at function1 (file.ts:123)
  at function2 (file.ts:456)
```

### ✅ Playful Error
```
✗ FAULT!
  ├─ First serve: out of bounds
  ├─ Second serve: net
  └─ Double fault: Invalid input format
  
  💡 Tip: Check your serve (input) and try again
```

### Tone Guidelines
- **DO**: Use tennis metaphors, be encouraging
- **DO**: Celebrate wins ("ACE!", "Winner!")
- **DO**: Make errors feel recoverable ("Let", "Fault - retry?")
- **DON'T**: Use corporate jargon ("leveraging synergies")
- **DON'T**: Be overly verbose
- **DON'T**: Hide information behind cuteness

---

## Output Mockups

### Simple Task Completion
```
$ karl "create hello.txt with hello world"

● Serving task to cliffy...

   ✍️  write → hello.txt
   
⚡ ACE! (0.8s)

$ cat hello.txt
hello world
```

### Multi-Tool Task
```
$ karl "read package.json and add lodash dependency"

● Serving task to sonnet...

   📖 read → package.json
   ✍️  write → package.json
   
⚡ ACE! (1.2s)
   └─ 2 tools, 567 tokens

Changes:
  + "lodash": "^4.17.21"
```

### Volley Mode (Parallel Tasks)
```
$ karl volley --tasks tasks.txt

▶ VOLLEY IN PROGRESS (3 tasks)

  [1] ●─────────────── Creating auth.ts
  [2] ─────────●────── Testing login flow  
  [3] ───────────────● Writing docs

⚡ ACE! Task 3 complete (0.9s)
⚡ ACE! Task 1 complete (1.1s)
⚡ ACE! Task 2 complete (1.4s)

╔══════════════════════════════╗
║  3 ACES  │  0 FAULTS  │ 100% ║
╚══════════════════════════════╝
```

### Error with Recovery
```
$ karl "delete production database"

● Serving task to cliffy...

⚠ LET! - Dangerous operation detected
   
   This looks risky. Did you mean to:
   • Delete development database?
   • Backup then delete?
   
   Retry? (y/N)
```

### Verbose Mode
```
$ karl --verbose "optimize image.png"

╔═══════════════════════════════════════════╗
║  KARL v1.0.0  │  Stack: cliffy (haiku)   ║
╚═══════════════════════════════════════════╝

● Serving...
  ├─ Model: claude-3-haiku-20240307
  ├─ Max tokens: 4096
  └─ Skills: none

📖 read → image.png (342 KB)
   └─ Binary file detected

⚙️  bash → convert image.png -quality 85 image_opt.png
   ├─ stdout: ✓
   ├─ stderr: (empty)
   └─ exit: 0

✓ Optimized: 342 KB → 156 KB (54% reduction)

⚡ ACE! (2.1s)
   ├─ Tools called: 2
   ├─ Tokens: 1,234 in / 234 out
   ├─ Cost: $0.0012
   └─ Model: claude-3-haiku-20240307

- - - - - - - - - - - - - - - - - - - - -

Image optimization complete!
Saved 186 KB (54% smaller)
```

### Skill Loading
```
$ karl --skill rust "refactor this module"

🧠 Loading skill: rust
   ├─ rust-best-practices.md
   ├─ cargo-commands.md
   └─ ownership-patterns.md
   
● Serving with rust expertise...

   📖 read → module.rs
   ✍️  write → module.rs
   
⚡ ACE! (1.8s)
   └─ Applied: ownership patterns, error handling
```

---

## Animated Sequences

### Startup Banner
```
  ██╗  ██╗ █████╗ ██████╗ ██╗     
  ██║ ██╔╝██╔══██╗██╔══██╗██║     
  █████╔╝ ███████║██████╔╝██║     
  ██╔═██╗ ██╔══██║██╔══██╗██║     
  ██║  ██╗██║  ██║██║  ██║███████╗
  ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝
  
  13,728 ACES. ZERO RALLIES.
  
  Ready to serve ●
```

### Ace Celebration
```
      ⚡
     ⚡ ⚡
    ⚡ A ⚡
   ⚡  C  ⚡
  ⚡   E   ⚡
 ⚡  ⚡  ⚡  ⚡
⚡ ⚡ ⚡ ⚡ ⚡ ⚡

   ONE SHOT!
```

### Processing Spinner Variations

**Option 1: Ball Spin**
```
●  ◐  ◓  ◑
```

**Option 2: Racket Swing**
```
|  /  —  \  |
```

**Option 3: Serve Arc**
```
    ●
   ●    ●
  ●      ●
 ●        ●
●→→→→→→→→→●
```

**Option 4: Court Traverse**
```
|●                    |
|  ●                  |
|    ●                |
|      ●              |
|        ●            |
|          ●          |
|            ●        |
|              ●      |
|                ●    |
|                  ●  |
|                    ●|
```

### Task Queue Animation
```
QUEUE:
  ○ ○ ○ ○ ○  →  ● ○ ○ ○ ○  →  ⚡ ● ○ ○ ○  →  ⚡ ⚡ ● ○ ○
  
  ○ = queued
  ● = serving
  ⚡ = ace!
```

---

## Decorative Elements

### Section Dividers
```
═══════════════════════════════════════════

─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─

• • • • • • • • • • • • • • • • • • • • • •

─────────────────●─────────────────

```

### Headers
```
╔═══════════════════════════════════════════╗
║               KARL RESULTS                ║
╚═══════════════════════════════════════════╝

or minimal:

━━━ KARL RESULTS ━━━

or playful:

●─────  KARL RESULTS  ─────●
```

### Boxes
```
┌─────────────────────────────┐
│  Context loaded             │
│  Ready to serve             │
└─────────────────────────────┘

╭─────────────────────────────╮
│  🎾 Tip: Use --verbose      │
│  for detailed output        │
╰─────────────────────────────╯

┏━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃  ⚠️  WARNING: Dangerous    ┃
┃  operation ahead           ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
```

### Stats Display
```
╔════════════════════════════════════════╗
║  SESSION STATS                         ║
╠════════════════════════════════════════╣
║  ⚡ Aces:       42                     ║
║  ✗ Faults:      3                     ║
║  ● Serves:     45                     ║
║  🎯 Accuracy:  93%                     ║
║  ⏱  Avg time:  1.2s                    ║
╚════════════════════════════════════════╝
```

### Tree Structures
```
task/
├─ subtask-1 ⚡
├─ subtask-2 ●
└─ subtask-3 ○

context/
├─ file-1.md ✓
├─ file-2.md ✓
└─ skills/
   ├─ rust.md ✓
   └─ typescript.md ✓
```

---

## Context-Aware Theming

### Success Context (Green energy)
```
⚡ ACE!
  └─ Task completed perfectly
  └─ Token efficiency: 95%
  
✓ All tests passing
```

### Warning Context (Yellow caution)
```
⚠ LET - Retrying...
  └─ First serve: rate limit
  └─ Second serve: queued
  
○ Waiting for API...
```

### Error Context (Red alert)
```
✗ FAULT!
  └─ Out of bounds: file not found
  
💡 Try: karl --help
```

### Info Context (Blue calm)
```
● Serving task...
  └─ Model: sonnet
  └─ Context: 4,567 tokens
  
📖 Reading documentation...
```

---

## Special Moments

### First Time User
```
╔═══════════════════════════════════════════╗
║                                           ║
║          Welcome to KARL! 🎾              ║
║                                           ║
║   Named after Ivo Karlović - the 6'11"   ║
║   Croatian legend with 13,728 aces.      ║
║                                           ║
║   Philosophy: Serve and volley.          ║
║   One shot. No rallies.                  ║
║                                           ║
╚═══════════════════════════════════════════╝

Ready for your first serve? Try:

  $ karl "create a hello world program"
  $ karl --help
  $ karl --version
```

### Perfect Streak
```
        🏆
      ⚡ ⚡ ⚡
    ⚡ ⚡ ⚡ ⚡ ⚡
  
  10 ACES IN A ROW!
  You're on fire! 🔥
```

### Milestone Reached
```
╔═══════════════════════════════════════════╗
║  🎯 MILESTONE: 100 ACES!                  ║
║                                           ║
║  You're becoming a serve-and-volley pro!  ║
╚═══════════════════════════════════════════╝
```

---

## Implementation Notes

### Dynamic Width
All ASCII art should adapt to terminal width:
- Minimum: 60 chars (mobile/tmux)
- Standard: 80 chars (traditional terminal)
- Wide: 120+ chars (modern displays)

### Color Palette (when supported)
```
⚡ ACE     → Bright green (#00ff00)
✗ FAULT   → Red (#ff0000)
⚠ WARNING → Yellow (#ffff00)
● ACTIVE  → Cyan (#00ffff)
○ QUEUED  → Gray (#888888)
```

### Accessibility
- Always include text alternatives
- Don't rely solely on symbols
- Support `--no-emoji` flag
- Support `--plain` for pure text output

### Performance
- Lazy load decorative elements
- Cache generated ASCII art
- Disable animations in CI/CD (detect non-TTY)
- Respect `NO_COLOR` environment variable

---

## Future Ideas

### Interactive ASCII Game
```
$ karl --tennis-break

╔═══════════════════════════════════════════╗
║  Your serve! Press SPACE to hit...       ║
║                                           ║
║  YOU: 0  │  KARL: 0                      ║
║                                           ║
║                     ●                     ║
║                                           ║
║  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  ║
╚═══════════════════════════════════════════╝
```

### ASCII Art Logo Variations
```
Minimal:
  K●

Compact:
  K▶RL

Full:
  ██╗  ██╗
  ██║ ██╔╝
  █████╔╝
  ██╔═██╗
  ██║  ██╗
  ╚═╝  ╚═╝

With ball:
  ██╗  ██╗ ●
  ██║ ██╔╝
  █████╔╝
  ██╔═██╗
  ██║  ██╗
  ╚═╝  ╚═╝
```

### Court State Visualization
```
╔═══════════════════════════════════════════╗
║  KARL (Serving)    │    TASK (Returning)  ║
╠═══════════════════════════════════════════╣
║                                           ║
║  ┌──────────────┐   ┌──────────────┐     ║
║  │              │   │              │     ║
║  │      ●→      │   │              │     ║
║  │              │   │              │     ║
║  └──────────────┘   └──────────────┘     ║
║                                           ║
║  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  ║
║                                           ║
╚═══════════════════════════════════════════╝
```

---

## Conclusion

Karl's visual identity should feel:
- **Fast** like a serve (not slow/loading)
- **Confident** like an ace (not uncertain)
- **Playful** like tennis (not corporate)
- **Clean** like a winner (not cluttered)
- **Respectful** of the terminal (not intrusive)

Remember: Every output is a serve. Make it count. ⚡

**13,728 aces. Zero rallies. Pure Karl.** 🎾
