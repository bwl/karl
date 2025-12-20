# RETRO_AESTHETICS.md

*A guide to tasteful terminal nostalgia for Karl*

## Philosophy: Retro Without the Regret

The best retro design doesn't scream "I'M RETRO!" - it whispers with careful typography, subtle references, and deliberate constraints. We're not building a museum piece; we're channeling the *feel* of computing's golden age while respecting modern sensibilities.

**The Golden Rule**: Nostalgia should enhance usability, never hinder it.

---

## 🖥️ 80s Computing Nostalgia Elements

### What Made Those Machines Magical

The early home computing era (1977-1989) had distinctive characteristics worth preserving:

**The Good:**
- **Immediate feedback** - No loading bars, instant responses
- **Character-cell clarity** - 40/80 column modes, readable from across the room
- **Beeps that meant something** - Each sound had semantic meaning
- **Manual culture** - Documentation was beautiful, technical, respectful
- **Hacker aesthetic** - Everything was tweakable, nothing was hidden

**The Bad (avoid these):**
- Artificial limitations (we have RAM now!)
- Hostile UX that required manual reading (use good defaults)
- Cryptic error messages (be helpful, not authentic to a fault)

### Spiritual Ancestors

Systems Karl channels in spirit:
- **VAX/VMS** - Professional, robust, informative messages
- **Amiga Workbench** - Playful but powerful
- **BBC Micro** - Educational, encouraging experimentation
- **NeXT** - Minimal, elegant, developer-focused
- **Unix v7** - Composable, terse but not cryptic

---

## 🌈 Color Philosophy: Phosphor Dreams

### The Classic Palettes

**Monochrome Phosphors** (1977-1985):
```
Green P1  : #00FF00  (IBM 5151)
Amber P3  : #FFBB00  (Zenith ZVM-122)  
White P4  : #FFFFFF  (Apple ///)
```

**Why they worked:**
- High contrast in dim rooms
- Easy on eyes for long sessions (subjective!)
- Looked *professional* compared to TVs
- Each color had a community (green = business, amber = programmers, white = Apple)

### Modern Terminal Color Theory

**Don't simulate phosphor glow** - we're not a CRT emulator.

**Do:**
- Offer retro-inspired themes as options
- Use high-contrast combinations for accessibility
- Keep primary/accent colors restrained (2-3 max for UI chrome)
- Let ANSI 256/truecolor shine in *content*, not UI
- Consider colorblindness (10% of users)

**Karl's Default Palette Concept:**
```
Background:  #0C0C0C  (not pure black - easier on eyes)
Foreground:  #C0C0C0  (soft white)
Accent:      #00D787  (mint green - fresh, not harsh)
Warning:     #FFB454  (warm amber)
Error:       #FF6B6B  (coral red - not angry)
Dim:         #606060  (comments, secondary info)
```

**Why this works:**
- Nods to green phosphor without being literal
- High WCAG contrast ratios
- Works in light/dark terminal emulators
- Distinct semantic colors
- Not trying to be a "theme" - just clear hierarchy

### Theme System Ideas

Let users bring their own aesthetics:
```bash
# Environment var
export KARL_THEME="phosphor-green"
export KARL_THEME="amber-classic"  
export KARL_THEME="dracula"
export KARL_THEME="none"  # respects terminal colors

# Config file
~/.config/karl/theme.json
```

**Bundled themes (tasteful):**
- `modern` - default
- `phosphor` - green accent, minimal
- `amber` - warm tones
- `monochrome` - pure white/gray
- `synthwave` - if we must (muted, not garish)

---

## 📦 Box Drawing Characters: The Lost Art

### Unicode Box Drawing (U+2500 to U+257F)

The building blocks of terminal UI:

```
┌─────────────┐
│ Light Box   │
└─────────────┘

╔═════════════╗
║ Heavy Box   ║
╚═════════════╝

╭─────────────╮
│ Rounded Box │
╰─────────────╯

┏━━━━━━━━━━━━━┓
┃ Heavy Round ┃
┗━━━━━━━━━━━━━┛
```

**Karl's Box Strategy:**

Use **rounded light boxes** for friendly UI:
```
╭──────────────────────────────╮
│ ⚡ Serving prompt to sonnet  │
│ Context: 2,048 tokens        │
╰──────────────────────────────╯
```

Use **heavy boxes** for important alerts:
```
╔════════════════════════════════╗
║  ⚠️  Model switched to opus   ║
║  Cost: ~$0.15 per call        ║
╚════════════════════════════════╝
```

Use **plain lines** for separators:
```
────────────────────────────────
Task completed in 2.3s
────────────────────────────────
```

### Advanced Box Techniques

**Nested boxes:**
```
╭─ Volley Results ───────────────╮
│                                │
│  ╭─ Task 1: ✓ Complete ──╮    │
│  │ Added error handling  │    │
│  ╰───────────────────────╯    │
│                                │
│  ╭─ Task 2: ✓ Complete ──╮    │
│  │ Updated documentation │    │
│  ╰───────────────────────╯    │
│                                │
╰────────────────────────────────╯
```

**Progress indicators:**
```
╭─ Processing ──────────────────╮
│ ████████████░░░░░░░░  60%     │
╰────────────────────────────────╯
```

**Truncation with ellipsis:**
```
╭─ Long Filename Display ──────╮
│ very_long_filename_that_w…   │
╰───────────────────────────────╯
```

### When NOT to Use Boxes

- Piped output (check if stdout is TTY)
- JSON mode
- When `--plain` flag is set
- In CI/CD environments (respect NO_COLOR)
- For simple one-line messages (overkill)

---

## 🎨 ANSI Art: History & Inspiration

### The Golden Age (1985-1995)

**BBS Culture:**
- Login screens that WOWed at 2400 baud
- ANSI art groups (ACiD, iCE)
- Every board had a unique visual identity
- Limitations bred creativity (80x25, 16 colors)

**The Masters:**
- Character shading techniques
- Forced perspective
- Color blending through dithering
- Animated sequences

### Modern ANSI in 2024

**Tools worth knowing:**
- `chafa` - image to ANSI converter
- `jp2a` - JPEG to ASCII
- `figlet` - ASCII text banners
- `toilet` - colorful text rendering
- `boxes` - ASCII box drawing

### Karl's ASCII Strategy

**Subtle branding:**
```
 _  __         _
| |/ /__ _ _ _| |
| ' </ _` | '_| |
|_|\_\__,_|_| |_|

Serve-and-volley AI assistant
```

**Not this:**
```
╔═══════════════════════════════════════╗
║                                       ║
║  ██╗  ██╗ █████╗ ██████╗ ██╗         ║
║  ██║ ██╔╝██╔══██╗██╔══██╗██║         ║
║  █████╔╝ ███████║██████╔╝██║         ║
║  ██╔═██╗ ██╔══██║██╔══██╗██║         ║
║  ██║  ██╗██║  ██║██║  ██║███████╗    ║
║  ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝    ║
║                                       ║
║  THE ULTIMATE AI SERVE-AND-VOLLEY    ║
║         POWER TOOL 3000!              ║
║                                       ║
╚═══════════════════════════════════════╝
```

**Easter eggs (use sparingly):**
```bash
karl --version

Karl v1.0.0 - "First Serve"
13,728 lines of code (one for each Karlović ace)

karl ace --help
# Hidden alias that explains the tennis metaphor
```

### Tennis Court ASCII

For `--verbose` mode or `--about`:
```
     NET
═════╪═════
     │       
  🎾 │ 🏃    Serving prompt...
     │       Waiting for return...
═════╧═════
```

Minimal, playful, not in your face.

---

## 🎭 Retro Without Gimmick: The Balance

### Anti-Patterns to Avoid

❌ **Fake CRT effects** (scanlines, bloom, curvature)
   - We're a CLI, not cool-retro-term
   - Hurts readability
   - Gimmicky

❌ **Blinking text everywhere**
   - ANSI blink is disabled in most terminals
   - Annoying even when it works
   - Reserve for critical alerts only

❌ **Wall-of-text ASCII art on every run**
   - Wastes vertical space
   - Slow over SSH
   - Gets old fast

❌ **Intentionally cryptic messages**
   - "ABORT RETRY FAIL" is not good UX
   - Be helpful, not authentic

❌ **Beeps without context**
   - Respect `VISUAL_BELL` environment
   - Never beep on success (annoying)
   - Maybe beep on error if --bell flag

### Patterns to Embrace

✅ **Fixed-width layouts that align perfectly**
   - Monospace fonts make this trivial
   - Satisfying to scan
   - Professional look

✅ **Semantic use of bold/dim/color**
   - Bold for commands/files
   - Dim for metadata
   - Color for status

✅ **Consistent formatting**
   - Timestamps always same format
   - Paths always styled same way
   - Errors always have same structure

✅ **Subtle animations (spinners, progress)**
   - Keep user informed
   - Don't block interaction
   - Clear when done

✅ **Hidden depth (progressive disclosure)**
   - Simple by default
   - Verbose mode shows internals
   - Debug mode shows everything

---

## 🔤 Pixel Fonts & Fixed-Width Beauty

### The Monospace Aesthetic

**Classic Terminal Fonts:**
- **IBM VGA 8x16** - The DOS look
- **Apple ][ 40-column** - Chunky, friendly
- **Commodore 64 PETSCII** - Unique character set
- **Terminus** - Modern, crisp, designed for long sessions
- **Iosevka** - Narrow, efficient, lots of ligatures
- **JetBrains Mono** - Excellent code readability

**What makes monospace beautiful:**
- **Rhythm** - Every character occupies same space
- **Alignment** - Columns line up naturally
- **Predictability** - You can count characters visually
- **Focus** - No typographic distractions

### Designing for Monospace

**Column-aware layouts:**
```
Task                       Status    Time
──────────────────────────────────────────
Update documentation       ✓         1.2s
Refactor error handling    ✓         3.4s
Add test coverage          ⏳        -
```

**Right-aligned numbers:**
```
Tokens:  2,048
Cost:   $0.015
Time:    3.21s
```

**Box layouts with padding:**
```
╭─ System Info ──────────────────╮
│                                │
│  Model:  sonnet-3.5            │
│  Stack:  default               │
│  Skill:  typescript, unix      │
│                                │
╰────────────────────────────────╯
```

### ASCII Diagrams

```
Skill Resolution:
┌──────────┐
│ Request  │
└────┬─────┘
     │
     ├─► Check explicit --skill flag
     │   └─► Load if provided
     │
     ├─► Scan working directory
     │   ├─► package.json → load typescript
     │   ├─► Cargo.toml  → load rust
     │   └─► Makefile    → load c
     │
     └─► Apply defaults
         └─► Always: unix, core
```

---

## 🔊 Sound Design: Retro Computing Audio

### The Problem with Terminal Sounds

Most terminal emulators have poor audio support:
- BEL character (`\a`) is often disabled
- System beeps are jarring
- No standard for playing audio from CLI

### If We Did Sound...

**Tasteful options:**
- **Error**: Low-pitched beep (C2, 100ms)
- **Warning**: Mid beep (F3, 80ms)  
- **Success**: High beep (C4, 60ms) + slight decay
- **Volley complete**: Three-tone ascending sequence

**Implementation:**
```bash
# Respect user preferences
if [[ -n "$KARL_BELL" ]] && [[ ! -f ~/.config/karl/no-sound ]]; then
  printf '\a'  # Only if explicitly enabled
fi
```

**Better idea: Visual "sound"**
```
✓ Done. [♪]
✗ Error [♯]
⚠ Warning [♬]
```

Suggests audio feedback without requiring it.

### Classic Computer Sounds to Reference

- **Apple ][** - Disk drive seeking (rhythmic clicking)
- **Commodore 64** - Datasette loading (musical warbling)
- **Dial-up modem** - Handshake sequence (iconic)
- **Hard drive** - Spinup/spindown (anticipation)
- **Dot matrix** - Print head (productivity sound)

**The Vibe**: Mechanical, purposeful, satisfying

**For Karl**: Maybe a loading indicator that *suggests* disk activity:
```
⠋ Loading context...
⠙ Loading context...
⠹ Loading context...
⠸ Loading context...
⠼ Loading context...
```

Braille spinner pattern - feels like old-school activity.

---

## 🥚 Easter Eggs: Classic Software Homages

### Principles

1. **Never interfere with normal usage**
2. **Discoverable but not obvious**
3. **Delightful, not annoying**
4. **Educational or meaningful**

### Ideas

**1. Cowsay-style celebratory ACE:**
```bash
karl --cowsay
 _________________
< One-shot! ACE! >
 -----------------
    \   🎾
     \  🏃‍♂️
```

**2. Konami code equivalent:**
```bash
karl ↑ ↑ ↓ ↓ ← → ← → b a
# or
karl up up down down left right left right b a

Unlocked: Verbose tennis commentary mode
"What a serve! Karlović delivers another ace..."
```

**3. Version messages:**
```bash
karl version
karl 1.0.0

karl --version
1.0.0

karl -v
1.0.0

karl -vv  
Karl v1.0.0 "First Serve"
Built: 2024-01-15 14:23 UTC
Runtime: Bun v1.x.x

karl -vvv
# Full system diagnostic + ASCII art
```

**4. Hidden aliases:**
```bash
karl ace     # Explain the tennis metaphor
karl fault   # Show recent errors
karl let     # Replay last command (tennis "let")
karl deuce   # Show tied tasks (equal priority)
```

**5. Time-based messages:**
```bash
# If run at exactly 13:37
Karl says: 1337 o'clock - peak hacker time 🏴‍☠️

# On Wimbledon dates (late June/early July)
Karl says: Grass court season! 🎾
```

**6. Fortune-style tennis facts:**
```bash
karl --fortune

Did you know?
Ivo Karlović hit his 13,728th ace at age 40.
Consistency beats flash. Keep serving.
```

**7. Nod to classic Unix:**
```bash
karl --gandalf
You shall not pass... invalid arguments!

karl --bsd
Copyright (c) 2024 Karl Contributors
All rights reserved.
[Full BSD license text]

karl --rms
# Absolutely nothing happens, with a sly comment in source:
# "RMS would want you to read the source code yourself."
```

**8. Terminal size easter egg:**
```bash
# If terminal is exactly 80x24 (classic)
╭────────────────────────────────────────╮
│  Classic 80x24 detected!              │
│  You are a person of refined taste.   │
╰────────────────────────────────────────╯
```

**9. Eliza-style AI conversation:**
```bash
karl therapist
> Hello, I am Karl. Tell me about your codebase.
> You mentioned "bugs" - how does that make you feel?
> Have you tried turning it off and on again?
```

**10. Classic error messages:**
```bash
# With --retro flag
? Syntax error in line 0

PC LOAD LETTER

Abort, Retry, Fail?

Guru Meditation Error

# Always with helpful modern explanation below
```

---

## 🎯 Modern Usability First

### Never Sacrifice These

**Accessibility:**
- Respect NO_COLOR environment variable
- Provide `--plain` flag for script parsing
- WCAG AA contrast minimums
- Screen reader friendly output

**Performance:**
- Don't render complex ANSI art on every invocation
- Cache rendered boxes if reused
- Minimal overhead for visual flair

**Cross-platform:**
- Windows has limited Unicode in older terminals
- Some emulators don't support 256 color
- Graceful degradation

**User Control:**
```bash
# Let users opt out of everything
export KARL_PLAIN=1        # No colors, no boxes
export KARL_ASCII=0        # No ASCII art
export KARL_EMOJI=0        # No emoji
export NO_COLOR=1          # Industry standard

# Config file
~/.config/karl/config.json
{
  "ui": {
    "style": "minimal",
    "boxes": false,
    "emoji": false,
    "color": false
  }
}
```

### Progressive Enhancement

**Default**: Clean, professional, subtle retro touches
```
→ Running task with sonnet
✓ Complete in 2.1s
```

**With --verbose**: More detail, some visual flair
```
╭─ Task Execution ──────────────────╮
│ Model:  sonnet-3.5                │
│ Stack:  default                   │
│ Skills: typescript, unix          │
╰───────────────────────────────────╯

⚡ Serving prompt...
⚡ Returning result...
✓ ACE! Completed in 2.1s
```

**With --fancy**: Full retro experience
```
     _  __         _ 
    | |/ /__ _ _ _| |
    | ' </ _` | '_| |
    |_|\_\__,_|_| |_|
    
═════════════════════════════════════
     NET
═════╪═════
     │       
  🎾 │ 🏃    Serving to sonnet-3.5
     │       
═════╧═════

╭─ Match Setup ────────────────────╮
│                                  │
│  Court:  ~/.config/karl/         │
│  Stack:  default                 │
│  Skill:  typescript, unix        │
│                                  │
╰──────────────────────────────────╯

⠋ Warming up...
⚡ SERVE!
   
   ... [response streams] ...
   
✓ ACE! 🎾
  One-shot completion
  Time: 2.1s
  Cost: $0.003
  
═════════════════════════════════════
    Match stats: 1 ace, 0 faults
```

---

## 🖼️ Visual Hierarchy Examples

### Command Output (Default)

```
$ karl "add error handling to auth.ts"

→ sonnet-3.5 · 2,048 tokens

✓ Updated auth.ts
  Added try-catch blocks
  Improved error messages
  
2.3s · $0.004
```

### Command Output (Verbose)

```
$ karl -v "add error handling to auth.ts"

╭─ Context ──────────────────────────╮
│ Files: auth.ts (348 lines)         │
│ Skills: typescript                 │
│ Model: sonnet-3.5                  │
╰────────────────────────────────────╯

⚡ Serving prompt...
   Tokens: 2,048

   [Streaming response...]

✓ Task complete
  
  Modified:
  • auth.ts (+23, -5 lines)
  
  Changes:
  • Added try-catch blocks
  • Improved error messages  
  • Added logging
  
╭─ Stats ────────────────────────────╮
│ Time:   2.3s                       │
│ Cost:   $0.004                     │
│ Tokens: 2,048 → 512                │
╰────────────────────────────────────╯
```

### Error Messages (Helpful Retro)

```
✗ Model not found: sonnet-9000

Available models:
  • cliffy (fast, cheap)
  • sonnet (balanced)
  • opus (powerful)
  
Try: karl --list-models

? Syntax error
──────────────────────────────────────
Expected --model <name>, got --modal

Did you mean --model?
```

### Volley Mode Output

```
$ karl volley tasks.json

╭─ Volley: 3 tasks in parallel ─────╮
│                                   │
│  [1] ⠋ Update docs                │
│  [2] ⠙ Add tests                  │
│  [3] ⠹ Refactor utils             │
│                                   │
╰───────────────────────────────────╯

╭─ Task 1: ✓ Complete ──────────────╮
│ Updated documentation             │
│ 1.2s · $0.002                     │
╰───────────────────────────────────╯

╭─ Task 2: ✓ Complete ──────────────╮
│ Added test coverage               │
│ 3.4s · $0.006                     │
╰───────────────────────────────────╯

╭─ Task 3: ✓ Complete ──────────────╮
│ Refactored utility functions      │
│ 2.1s · $0.003                     │
╰───────────────────────────────────╯

════════════════════════════════════
✓ All tasks complete! 
  3/3 aces · 3.4s · $0.011
════════════════════════════════════
```

---

## 🎨 Color Usage Guide

### Semantic Colors

```
Status:
  ✓ Success   → Green/Mint
  ✗ Error     → Red/Coral  
  ⚠ Warning   → Yellow/Amber
  ℹ Info      → Blue/Cyan
  ⏳ Progress  → Gray/Dim

Code elements:
  Functions   → Yellow
  Strings     → Green
  Numbers     → Cyan
  Keywords    → Magenta
  Comments    → Dim

UI Chrome:
  Borders     → Dim white
  Headings    → Bold white
  Labels      → Normal white
  Values      → Accent color
  
Tennis theme:
  🎾 Ball     → Yellow/white
  🏃 Player   → Accent
  Net         → Dim
```

### ANSI Escape Sequences

```typescript
// Karl's color palette (using ANSI 256)
const colors = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  
  // Semantic
  success: '\x1b[38;5;42m',   // Green
  error:   '\x1b[38;5;203m',  // Coral red
  warning: '\x1b[38;5;214m',  // Amber
  info:    '\x1b[38;5;81m',   // Cyan
  
  // UI
  accent:  '\x1b[38;5;42m',   // Mint green (phosphor nod)
  border:  '\x1b[38;5;240m',  // Dim gray
  
  // Code (for syntax highlighting)
  keyword: '\x1b[38;5;170m',  // Magenta
  string:  '\x1b[38;5;114m',  // Soft green
  number:  '\x1b[38;5;81m',   // Cyan
  comment: '\x1b[38;5;244m',  // Dim
};

// Respect NO_COLOR
const useColor = !process.env.NO_COLOR && process.stdout.isTTY;
```

---

## 📐 Layout Principles

### Terminal Width Awareness

```typescript
// Detect terminal width
const width = process.stdout.columns || 80;

// Responsive boxes
function makeBox(content: string) {
  const maxWidth = Math.min(width - 4, 80); // Never wider than 80
  const minWidth = 40; // Minimum readable
  
  if (width < minWidth) {
    // Fallback for narrow terminals
    return `| ${content}`;
  }
  
  // Calculate actual width
  const boxWidth = Math.max(minWidth, Math.min(maxWidth, content.length + 4));
  
  // Render box...
}
```

### Vertical Rhythm

```
Command
[blank line]
Output section 1
[blank line]
Output section 2
[blank line]
Final stats
```

Don't crowd the terminal - white space is retro too!

### Alignment

```
Task                         Status    Duration    Cost
────────────────────────────────────────────────────────
Update docs                  ✓         1.2s        $0.002
Add error handling           ✓         3.4s        $0.006
Refactor                     ✓         2.1s        $0.003
```

Pad with spaces, not tabs. Calculate column widths dynamically.

---

## 🎬 Animation Principles

### Good Animations

**Spinners** (show progress):
```
⠋ Loading...
⠙ Loading...
⠹ Loading...
⠸ Loading...
⠼ Loading...
⠴ Loading...
⠦ Loading...
⠧ Loading...
⠇ Loading...
⠏ Loading...
```

**Progress bars** (finite tasks):
```
[████████████░░░░░░░░] 60%
```

**Ellipsis** (waiting for response):
```
Waiting for model.
Waiting for model..
Waiting for model...
```

### Bad Animations

❌ Scrolling text (hard to read)
❌ Random flashing (seizure risk)
❌ Complex ASCII animations (slow)
❌ Anything that loops forever without progress

### Performance

- Update max 10 FPS (100ms)
- Clear line before redrawing: `\r\x1b[K`
- Use alternate screen buffer for TUI: `\x1b[?1049h`
- Restore on exit: `\x1b[?1049l`

---

## 🧪 Testing Retro Aesthetics

### Visual Regression

Keep screenshots of terminal output:
```
tests/
  visual/
    default-output.txt
    verbose-output.txt
    error-output.txt
    volley-output.txt
```

Run through strip-ansi to test content:
```typescript
import stripAnsi from 'strip-ansi';

test('output content', () => {
  const output = karl('test command');
  const clean = stripAnsi(output);
  expect(clean).toContain('Expected text');
});
```

### Cross-terminal Testing

Test in:
- **iTerm2** (macOS)
- **Terminal.app** (macOS)  
- **Windows Terminal** (Windows)
- **Alacritty** (Linux/macOS/Windows)
- **GNOME Terminal** (Linux)
- **tmux** (multiplexer)
- **SSH session** (ensure no binary output)

### Accessibility Check

```bash
# Check NO_COLOR support
NO_COLOR=1 karl test

# Check plain output
karl --plain test

# Check with limited colors
TERM=vt100 karl test
```

---

## 💎 Examples of Tasteful Retro CLIs

**Study these:**

1. **git** - Perfect balance of info density and readability
2. **htop** - Colorful, useful, not distracting
3. **ripgrep** - Fast, clear, great color defaults
4. **exa** - Icons done right (optional, semantic)
5. **bat** - Syntax highlighting that helps
6. **lazygit** - TUI that feels natural
7. **bottom** - Modern system monitor with retro charm
8. **neofetch** - ASCII art done purposefully

**Avoid these patterns:**

1. **hollywood** - Too much (intentionally)
2. **cmatrix** - Pure eye candy, no function
3. **sl** - Joke command (but funny once)
4. **cowsay** - Cute but low signal/noise ratio

---

## 🚀 Implementation Roadmap

### Phase 1: Foundation
- [ ] Color palette defined
- [ ] Box drawing utilities
- [ ] ANSI helper functions
- [ ] NO_COLOR support
- [ ] `--plain` flag

### Phase 2: Polish
- [ ] Spinners for async operations
- [ ] Progress bars for volley mode
- [ ] Consistent error formatting
- [ ] Status icons (✓✗⚠ℹ)

### Phase 3: Personality
- [ ] ASCII logo (minimal)
- [ ] Tennis metaphor in --verbose
- [ ] Themed output for different modes
- [ ] Easter eggs (subtle)

### Phase 4: Customization
- [ ] Theme system
- [ ] Config file support
- [ ] Environment variable overrides
- [ ] User preference detection

---

## 📚 Resources

### Box Drawing Reference
- Unicode: https://unicode.org/charts/PDF/U2500.pdf
- Utility: https://github.com/cronvel/terminal-kit

### ANSI Art
- 16colo.rs - Archive of ANSI/ASCII art
- ASCII Art Archive
- PETSCII - Commodore graphics

### Terminal Standards
- NO_COLOR: https://no-color.org/
- ANSI escape codes: https://en.wikipedia.org/wiki/ANSI_escape_code
- XTerm control sequences

### Inspiration
- /r/unixporn (aesthetics)
- /r/RetroComputing (hardware)
- Terminals Are Sexy (GitHub awesome list)

---

## 🎯 The North Star

**Karl should feel like:**
- A well-tuned sports car (fast, responsive)
- A master craftsman's tool (purposeful design)
- A 1980s workstation (professional, focused)
- A trusted teammate (helpful, not flashy)

**Not like:**
- A theme park (overwhelming stimuli)
- A museum (locked in the past)
- A toy (not serious enough)
- A puzzle (confusing to use)

Retro aesthetics in service of the user experience, not the other way around.

---

*"First serve: fast. Second serve: accurate. Every ace: satisfying."*  
*— The Karl Philosophy*
