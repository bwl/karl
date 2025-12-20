# Karl Moods

> "The ball doesn't care how you feel. But how you feel affects how you hit it."

Karl's mood system brings personality and adaptive behavior to the CLI without sacrificing Unix philosophy or speed. Like Karlović adjusting his game for clay vs grass, Karl adapts his style based on the work at hand.

## Philosophy

Moods aren't just cosmetic—they're execution profiles that affect:
- **Response verbosity** (token efficiency vs detail)
- **Speed preference** (fast models vs capable models)
- **Output style** (concise vs explanatory)
- **Tool usage patterns** (aggressive vs conservative edits)
- **Interaction density** (quiet vs communicative)

Think of moods as **meta-stacks**: they influence model selection, system prompts, and behavior patterns.

## Core Moods

### 🎯 **Focused** (Default)
*"Ivo at Wimbledon final. Every serve counts."*

```bash
karl --mood focused "refactor authentication system"
karl focus "optimize database queries"
```

**Characteristics:**
- Uses best model for the task (sonnet/opus when needed)
- Balanced verbosity—explains key decisions only
- Minimal ASCII art, maximum substance
- Shows tool calls but doesn't narrate them
- Perfect for production work and critical changes

**System prompt additions:**
- "Be decisive and thorough"
- "Explain architectural decisions but skip trivial details"
- "Prioritize correctness over speed"

---

### 🎾 **Playful** (Exploration mode)
*"Practice court energy. Try weird angles."*

```bash
karl --mood playful "make the 404 page fun"
karl play "add easter eggs to the CLI"
```

**Characteristics:**
- Creative suggestions and alternatives
- More ASCII art and tennis metaphors
- Uses cliffy/haiku for speed, rapid iteration
- Encourages experimentation
- Shows personality in responses

**System prompt additions:**
- "Be creative and suggest fun alternatives"
- "Use tennis metaphors when appropriate"
- "Embrace playful solutions"

**Example output:**
```
🎾 Serving up a 404 page...

   ___  ___  _ _   
  | | |/ _ \| | |  
  | |_| | | |_| |  
   \___/\_/  \___/  
   
  Looks like that route went out of bounds!
  
  ↩ Return to homepage
  🎾 Serve another request
```

---

### 🧘 **Zen** (Minimal output)
*"The ace speaks for itself."*

```bash
karl --mood zen "fix the bug in user.ts"
karl zen "deploy to staging"
```

**Characteristics:**
- Absolute minimum output
- No explanations unless errors occur
- No ASCII art, no commentary
- Perfect for scripts and automation
- Just results: ✓ or ✗

**System prompt additions:**
- "Minimal output only. Let the code speak."
- "No explanations unless something fails"
- "Success = silence"

**Example output:**
```
✓ user.ts
✓ user.test.ts
```

That's it. Done.

---

### 🔍 **Verbose** (Learning mode)
*"Film study. Break down every frame."*

```bash
karl --mood verbose "explain and implement OAuth flow"
karl verbose "walk me through this refactor"
```

**Characteristics:**
- Detailed explanations of every decision
- Shows reasoning before acting
- Explains tool usage and file changes
- Educational tone
- Perfect for learning or complex migrations

**System prompt additions:**
- "Explain your reasoning thoroughly"
- "Educational tone—help user understand"
- "Show before/after and why"

**Example output:**
```
📖 Let's implement OAuth flow step by step...

First, I'll analyze the current auth system to understand what we're working with.
Reading src/auth/current.ts to see the existing implementation...

Current system uses JWT tokens with a 24h expiry. We'll need to:
1. Add OAuth provider configuration
2. Implement callback handler
3. Update token refresh logic

Let me start with the provider config...
```

---

### ⚡ **Quick** (Speed priority)
*"First serve: 157 mph. No second chances needed."*

```bash
karl --mood quick "add type checking to api.ts"
karl quick "write unit test for parseUrl"
```

**Characteristics:**
- Always uses fastest model (cliffy/haiku)
- Good enough > perfect
- Minimal deliberation
- Single-pass edits
- Speed over thoroughness

**System prompt additions:**
- "Fast and functional. Don't overthink it."
- "First instinct is usually right"
- "Ship it"

---

### 🎓 **Coach** (Review and guidance)
*"Let's review the tape and improve your form."*

```bash
karl --mood coach "review my component architecture"
karl coach "how can I improve this code?"
```

**Characteristics:**
- Socratic questioning
- Suggests improvements but doesn't auto-apply
- Teaching-focused
- Shows multiple approaches
- Encourages best practices

**System prompt additions:**
- "Guide, don't do. Ask questions that prompt thinking."
- "Offer 2-3 alternatives with tradeoffs"
- "Focus on principles, not just fixes"

---

### 🏆 **Pro** (Production-hardened)
*"Grand Slam final. Zero margin for error."*

```bash
karl --mood pro "prepare release v2.0"
karl pro "security audit before deploy"
```

**Characteristics:**
- Maximum paranoia mode
- Checks before acting
- Asks for confirmation on risky changes
- Suggests rollback strategies
- Emphasizes testing and safety
- Uses opus-level models

**System prompt additions:**
- "Question everything. Safety first."
- "Suggest tests and validation for every change"
- "Think about failure modes"

---

## Setting Moods

### Explicit flags
```bash
karl --mood focused "task"
karl --mood playful "task"
karl --mood zen "task"
```

### Shorthand aliases
```bash
karl focus "task"
karl play "task"
karl zen "task"
karl quick "task"
karl coach "task"
karl pro "task"
```

### Environment variable
```bash
export KARL_MOOD=zen
karl "fix bug"  # uses zen mood
```

### Per-project config
```toml
# .karl/config.toml
[mood]
default = "focused"
```

---

## Automatic Mood Detection

Karl can infer mood from context clues:

### Language-based triggers
- "quickly" / "fast" → **quick**
- "explain" / "walk me through" → **verbose**
- "review" / "suggest" → **coach**
- "production" / "deploy" → **pro**
- "fun" / "creative" → **playful**
- "quiet" / "silent" → **zen**

### File patterns
- `.test.ts` being modified → **focused** (tests are serious)
- `README.md` / docs → **verbose** (explanation mode)
- `package.json` / config → **pro** (careful with deps)
- Asset files / CSS → **playful** (creative space)

### Pipe detection
```bash
karl "list files" | grep .ts  # Auto-zen: piped output
```

### Time-based (optional)
- Late night commits → **zen** (tired, need quiet)
- Working hours → **focused**

---

## Mood Indicators

Moods show in the prompt subtly:

```bash
# Focused (default)
karl> implementing OAuth...

# Playful
🎾 karl> making 404 page fun...

# Zen
· serving fix...

# Verbose
📖 karl> explaining OAuth implementation...

# Quick
⚡ karl> adding types...

# Coach
🎓 karl> reviewing architecture...

# Pro
🏆 karl> preparing production release...
```

Minimal, clear, not obnoxious.

---

## Mood Composition

### With Skills
Moods modify how skills execute:

```bash
# Skill with playful mood
karl play --skill rust "add ascii art to CLI"
# Uses Rust skill knowledge + playful creativity

# Skill with pro mood
karl pro --skill security "audit auth system"
# Uses security skill + maximum paranoia
```

### With Stacks
Moods can override stack model selection:

```bash
# Stack defines model, mood affects behavior
karl --stack backend --mood quick "add endpoint"
# Uses backend stack config but prioritizes speed

# Mood can suggest stack override
karl pro "deploy"  # might auto-switch to opus stack
```

### Mood > Stack precedence
When mood strongly suggests different model:
```bash
karl --stack cliffy --mood pro "security audit"
# Warning: pro mood recommends opus for security work
# Continue with cliffy? [y/N]
```

---

## Implementation Notes

### System Prompt Composition
```typescript
const systemPrompt = [
  baseSystemPrompt,
  stackSystemPrompt,
  skillSystemPrompt,
  moodSystemPrompt,  // Applied last, can override
].join('\n\n')
```

### Mood Configs
```typescript
// .karl/moods/focused.toml
[mood]
name = "focused"
emoji = "🎯"
verbosity = "balanced"
speed_priority = "quality"
model_preference = ["sonnet", "opus"]

[prompt]
additions = [
  "Be decisive and thorough",
  "Explain architectural decisions but skip trivial details"
]
```

### Custom Moods
Users can define their own:

```toml
# .karl/moods/hacker.toml
[mood]
name = "hacker"
emoji = "🔓"
verbosity = "minimal"
speed_priority = "fast"

[prompt]
additions = [
  "Move fast and break things",
  "Clever solutions over verbose ones",
  "Embrace chaos"
]
```

```bash
karl --mood hacker "bypass rate limiting"
```

---

## Mood Personalities

Each mood has a voice:

| Mood | Voice | Example response |
|------|-------|------------------|
| **Focused** | Professional, clear | "Refactored auth system. Extracted 3 reusable functions." |
| **Playful** | Creative, fun | "🎾 Added 404 page with tennis puns! *chef's kiss*" |
| **Zen** | Silent | "✓" |
| **Verbose** | Educational | "Here's why I chose this pattern: ..." |
| **Quick** | Terse, confident | "Done. Shipping." |
| **Coach** | Socratic, helpful | "What if we extracted that logic? Consider..." |
| **Pro** | Paranoid, thorough | "Added tests, rollback plan, monitoring. Safe to deploy." |

---

## Avoiding Annoyance

**DON'T:**
- Overuse emojis (1 per response max, or none in zen)
- Force tennis metaphors when they don't fit
- Add personality to error messages (errors are serious)
- Make zen mode chatty
- Let playful become unprofessional

**DO:**
- Keep personality in the *style*, not the volume
- Let zen be truly minimal
- Make focused the smart default
- Allow mood override with `--quiet` flag
- Respect when user pipes output (auto-zen)

---

## Future Ideas

### Mood Learning
```bash
karl --mood auto  # learns from your patterns
# Detects: "User always uses zen for git hooks" → auto-zen for scripts
```

### Mood Transitions
```bash
karl focus "build feature" --then-zen  
# Focused during work, zen for final output
```

### Mood Combos
```bash
karl --mood "playful+verbose"  # creative AND educational
karl --mood "quick+zen"         # fast AND quiet
```

### Contextual Mood Memory
```bash
# Karl remembers: "Last time we worked on docs, user wanted verbose"
cd docs/
karl "update api reference"  # auto-suggests verbose mood
```

---

## Tennis Wisdom

> "Karlović didn't change his serve for every point. He had a game plan and stuck to it—but he knew when to adjust."

Moods aren't about being random. They're about **intentional adaptation** to the work at hand. 

Focused by default. Zen when piped. Playful when creating. Pro when shipping.

**The ball doesn't care how you feel. But the right mood helps you hit the perfect shot.** 🎾

---

## CLI Reference

```bash
# Explicit mood
karl --mood <mood> "<task>"

# Shorthand
karl <mood> "<task>"

# List moods
karl moods

# Describe mood
karl mood focused --describe

# Set default mood
karl config set mood.default zen

# Disable mood system
karl --no-mood "<task>"
```

---

*Ace it. 🎾*
