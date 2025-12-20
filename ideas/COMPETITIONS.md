# 🎾 COMPETITIONS.md - Karl vs. Karl

> "The best way to improve your serve is to face someone who can return it."
> 
> *— Ivo Karlović (probably)*

When you're 6'11" and have 13,728 aces, sometimes the only worthy opponent is yourself.

---

## 🏆 Philosophy

Karl doesn't just execute tasks—it can compete with itself to find the best solution. Multiple models, multiple approaches, same goal: **deliver aces, not double faults.**

This is about:
- **Consensus**: When decisions matter, ask multiple models
- **Competition**: Pit models against each other to find the best
- **Evolution**: Learn from victories and defeats
- **Fun**: Because optimization should feel like a tournament

---

## 🎯 Core Competition Modes

### 1. Multi-Model Consensus 🤝

**When to use:** Critical decisions, code reviews, architectural choices

```bash
# Consensus mode: ask 3 models, require 2/3 agreement
karl --consensus 3 --task "Should we refactor this module?"

# Weighted consensus: some models count more
karl --consensus "opus:2,sonnet:1,haiku:1" --task "Review security implications"

# Show all reasoning
karl --consensus 3 --show-reasoning --task "Pick the best algorithm"
```

**How it works:**
1. Task distributed to N models in parallel (volley!)
2. Responses collected and compared
3. Similarity scoring determines agreement level
4. Present consensus or highlight disagreements
5. Optional: Use a judge model to break ties

**Output format:**
```
🎾 CONSENSUS MATCH (3 models)

Sonnet:  ✓ Refactor recommended - reduces complexity
Opus:    ✓ Refactor recommended - improves maintainability  
Haiku:   ✗ Keep as-is - not worth the effort

CONSENSUS: 2/3 AGREE - Refactor (66% confidence)

⚡ Use --judge to break the tie
```

---

### 2. Model Tournaments 🏅

**When to use:** Finding the best model for specific task types

```bash
# Run tournament: all models attempt the same task
karl tournament --task "Write a regex parser" --models all

# Specific bracket
karl tournament --models "sonnet,opus,devstral" --task "Optimize this SQL"

# Save winner as default for this task type
karl tournament --task-type "database" --save-winner
```

**Tournament Structure:**

```
                    🏆 CHAMPION
                         |
              ┌──────────┴──────────┐
           SEMIFINAL             SEMIFINAL
              |                     |
        ┌─────┴─────┐         ┌─────┴─────┐
      Round1      Round1     Round1      Round1
        |           |           |           |
      Opus      Sonnet     Devstral     Haiku
```

**Judging Criteria:**
- Code quality (if applicable)
- Response time
- Token efficiency
- Correctness (via tests)
- Clarity of explanation
- Cost per token
- User preference (optional manual ranking)

**Output:**
```
🎾 TOURNAMENT RESULTS

Task: "Write a regex parser"
Competitors: 4 models

┌─────────┬───────┬────────┬──────┬───────┬───────┐
│ Model   │ Score │ Time   │ Cost │ Tests │ Rank  │
├─────────┼───────┼────────┼──────┼───────┼───────┤
│ Opus    │ 94    │ 2.3s   │ $0.12│ 10/10 │ 🥇    │
│ Sonnet  │ 91    │ 1.8s   │ $0.04│ 9/10  │ 🥈    │
│ Devstral│ 87    │ 1.2s   │ $0.01│ 8/10  │ 🥉    │
│ Haiku   │ 76    │ 0.9s   │ $0.01│ 7/10  │ 4th   │
└─────────┴───────┴────────┴──────┴───────┴───────┘

💾 Save Opus as default for 'parsing' tasks? [y/N]
```

---

### 3. A/B Testing ⚖️

**When to use:** Comparing different prompts, skills, or approaches

```bash
# Test two approaches
karl ab --prompt-a "Be concise" --prompt-b "Be detailed" --task "Explain OAuth"

# Test skills
karl ab --skill-a "rust-expert" --skill-b "systems-programmer" --task "Write a memory allocator"

# Test models with same prompt
karl ab --model-a opus --model-b sonnet --runs 5
```

**Statistical Analysis:**

```
🎾 A/B TEST RESULTS (n=5)

Variant A: "Be concise" (Sonnet)
  Avg tokens: 234
  Avg time:   1.2s
  Avg cost:   $0.02
  User preference: ⭐⭐⭐⭐☆

Variant B: "Be detailed" (Sonnet)
  Avg tokens: 892
  Avg time:   3.4s
  Avg cost:   $0.08
  User preference: ⭐⭐⭐☆☆

WINNER: Variant A (p < 0.05)
  61% faster, 75% cheaper, preferred 4/5 times
```

---

### 4. Quality Scoring & Auto-Improvement 📊

**When to use:** Building quality metrics over time

```bash
# Score a response
karl score --response-id abc123 --rating 8/10

# Auto-improve based on past scores
karl --auto-improve --task "Write unit tests"

# Show quality trends
karl quality --skill "typescript" --last 30d
```

**Scoring System:**

- **Correctness** (30%): Does it work? Tests pass?
- **Efficiency** (20%): Token usage, execution time
- **Clarity** (20%): Readable, well-explained
- **Cost** (15%): $/task ratio
- **Elegance** (15%): Creative, idiomatic solutions

**Auto-Improvement Loop:**

```
┌─────────────┐
│  Task Input │
└──────┬──────┘
       │
       ▼
┌─────────────────────────┐
│ Generate Response       │
│ (with current best     │
│  model/skill/prompt)   │
└──────┬──────────────────┘
       │
       ▼
┌─────────────────────────┐
│ Execute & Score         │
│ - Run tests             │
│ - Measure metrics       │
│ - Compare to history    │
└──────┬──────────────────┘
       │
       ▼
    Better? ─Yes─> Update defaults
       │
       No
       │
       ▼
    Try different model/prompt
    (tournament mode)
```

**Quality Dashboard:**

```bash
karl quality --dashboard
```

```
📊 QUALITY DASHBOARD (Last 30 days)

Skill Performance:
  typescript      ████████████░░░░░░░░  8.2/10  (245 tasks)
  rust-expert     ██████████████░░░░░░  9.1/10  (89 tasks)
  python-data     ███████████░░░░░░░░░  7.8/10  (156 tasks)

Model Performance:
  Opus            ███████████████░░░░░  8.9/10  $45.23
  Sonnet          ████████████████░░░░  8.5/10  $12.87
  Haiku           ████████░░░░░░░░░░░░  7.2/10  $2.34

Recent Trends:
  📈 typescript quality +12% (switched to Sonnet default)
  📉 python-data cost -23% (Haiku for simple tasks)
  🎯 rust-expert 95% first-try success rate
```

---

### 5. Benchmark Mode 🎯

**When to use:** Testing skills against known challenges

```bash
# Run standard benchmark suite
karl benchmark --skill typescript

# Custom benchmark
karl benchmark --tests ./benchmarks/sorting.yaml

# Compare across models
karl benchmark --all-models --suite "code-golf"
```

**Benchmark Definition (YAML):**

```yaml
name: "TypeScript Skill Benchmark"
version: "1.0.0"
tasks:
  - id: "async-retry"
    description: "Implement exponential backoff retry"
    test_file: "./tests/async-retry.test.ts"
    max_time: 30s
    scoring:
      correctness: 40
      efficiency: 30
      readability: 30

  - id: "type-safety"
    description: "Create type-safe event emitter"
    test_file: "./tests/event-emitter.test.ts"
    max_time: 45s
    scoring:
      correctness: 50
      type_coverage: 30
      api_design: 20
```

**Benchmark Results:**

```
🎾 BENCHMARK: TypeScript Skill (Sonnet)

Task 1: async-retry                    ✓ PASS  (28.4s)
  Correctness:  40/40  All tests pass
  Efficiency:   27/30  Good performance
  Readability:  28/30  Clear code
  Score: 95/100

Task 2: type-safety                    ✓ PASS  (42.1s)
  Correctness:  50/50  Perfect
  Type Coverage: 25/30  89% coverage
  API Design:    18/20  Idiomatic
  Score: 93/100

─────────────────────────────────────────────
OVERALL SCORE: 94/100 🥇

Historical Average: 87/100
Improvement: +7 points
```

---

### 6. Leaderboards 🏆

**When to use:** Tracking performance over time and across contexts

```bash
# Global leaderboard
karl leaderboard

# Skill-specific
karl leaderboard --skill rust-expert

# Team/community leaderboards
karl leaderboard --team acme-corp

# Personal bests
karl leaderboard --user me
```

**Leaderboard Categories:**

1. **Ace Rate** - First-try success percentage
2. **Speed Serve** - Fastest completions
3. **Cost Efficiency** - Best quality/cost ratio
4. **Win Streak** - Consecutive successful tasks
5. **Versatility** - Success across diverse task types
6. **Grand Slam** - All benchmarks passed

**Display:**

```
🏆 KARL LEADERBOARD - ACE RATE (This Week)

┌────┬─────────────────┬───────────┬────────┬─────────┐
│Rank│ Model@Stack     │ Ace Rate  │ Tasks  │ Streak  │
├────┼─────────────────┼───────────┼────────┼─────────┤
│ 🥇 │ opus@precision  │ 94.3%     │ 423    │ 23 🔥   │
│ 🥈 │ sonnet@balanced │ 91.7%     │ 1,247  │ 15      │
│ 🥉 │ devstral@code   │ 88.9%     │ 356    │ 11      │
│  4 │ haiku@speed     │ 82.1%     │ 2,891  │ 7       │
│  5 │ trinity@custom  │ 79.4%     │ 124    │ 4       │
└────┴─────────────────┴───────────┴────────┴─────────┘

Your Rank: 🥈 Sonnet (↑2 from last week)
Next Challenge: Maintain 90%+ for 30 days for Grand Slam badge
```

---

### 7. Community Competitions 🌍

**When to use:** Sharing benchmarks, competing with other Karl users

```bash
# Upload your score
karl compete --challenge "advent-of-code-2024-day1" --submit

# Join ongoing competition
karl compete --join "fastest-parser-march-2024"

# Create competition
karl compete --create "best-sql-optimizer" --duration 7d

# View live rankings
karl compete --live "code-golf-spring-2024"
```

**Competition Types:**

1. **Code Golf** - Shortest correct solution (tokens)
2. **Speed Runs** - Fastest execution time
3. **Cost Challenge** - Best result under $0.01
4. **Quality Contest** - Highest benchmark scores
5. **Innovation Award** - Most creative solution (community vote)
6. **Relay Races** - Chain of tasks, cumulative score

**Competition Format:**

```
🌍 COMMUNITY COMPETITION

"Fastest JSON Parser - March 2024"

Duration: 7 days remaining
Entries: 1,247
Prize: Glory + Featured on karl.dev

Current Leaders:
  1. @alice    (devstral) - 234μs avg, 98% correct
  2. @bob      (opus)     - 245μs avg, 100% correct
  3. @charlie  (sonnet)   - 267μs avg, 99% correct

Your Best: 312μs (Rank: 47th)

💡 Tip: Try --skill "parser-expert" for better results
```

---

### 8. Self-Play for Skill Improvement 🔄

**When to use:** Iterative refinement of skills and prompts

```bash
# Self-play mode: generate, critique, improve
karl self-play --skill typescript --iterations 5

# Two models debate the best approach
karl debate --models "opus,sonnet" --task "Architecture for X"

# Evolutionary improvement
karl evolve --skill python-data --generations 10
```

**Self-Play Loop:**

```
Generation 0: Initial skill definition
     ↓
  Generate solution with Skill v1
     ↓
  Critique with different model
     ↓
  Improve skill based on critique → Skill v2
     ↓
  Generate solution with Skill v2
     ↓
  Compare v1 vs v2 (benchmark)
     ↓
  Keep better version
     ↓
  Repeat...
```

**Example Session:**

```
🎾 SELF-PLAY SESSION

Skill: typescript-testing
Iterations: 5
Goal: Maximize test coverage + readability

Gen 0 (baseline):  Score: 78/100  Coverage: 73%
Gen 1 (critique):  Score: 82/100  Coverage: 81%  ↑
Gen 2 (evolve):    Score: 85/100  Coverage: 87%  ↑
Gen 3 (refine):    Score: 84/100  Coverage: 86%  ↓ (rollback)
Gen 4 (mutate):    Score: 88/100  Coverage: 91%  ↑↑

CHAMPION: Gen 4
Improvement: +10 points, +18% coverage
Save as new default? [Y/n]

Changelog:
  + Added edge case handling
  + Better assertion patterns
  + Clearer test descriptions
  - Removed redundant setup code
```

**Debate Mode:**

```bash
karl debate --models "opus,sonnet" --rounds 3 --task "Microservices vs Monolith"
```

```
🎾 KARL vs KARL DEBATE

Topic: "Microservices vs Monolith for our use case"
Debaters: Opus (Pro-Microservices) vs Sonnet (Pro-Monolith)

Round 1:
  Opus:   Microservices enable independent scaling and deployment...
  Sonnet: But our team is small and complexity overhead is high...

Round 2:
  Opus:   True, but consider future growth and technology flexibility...
  Sonnet: The cost of distributed systems complexity outweighs benefits...

Round 3:
  Opus:   We can start with a modular monolith and extract later...
  Sonnet: Exactly my point - monolith first, with clear boundaries...

CONVERGENCE DETECTED!
Both models recommend: Modular monolith → selective extraction

Judge (Haiku): Agreement on hybrid approach. Consensus reached.
```

---

### 9. Cost-Quality Tradeoff Optimization 💰

**When to use:** Finding the sweet spot for your budget

```bash
# Pareto frontier exploration
karl optimize --task-type "documentation" --budget 100tasks

# Quality threshold mode
karl --min-quality 8.0 --optimize-cost --task "Generate README"

# Cost ceiling mode
karl --max-cost 0.05 --optimize-quality --task "Code review"
```

**Pareto Frontier:**

```
Quality vs Cost (Documentation Tasks)

10 │                    ● Opus
   │
 9 │              ● Sonnet
   │
 8 │         ● Sonnet (tuned)
   │
 7 │    ● Haiku (enhanced)
   │
 6 │ ● Haiku
   │
   └─────────────────────────────
     $0.01  $0.05  $0.10  $0.15

PARETO OPTIMAL:
  - Budget < $0.02  → Haiku (enhanced)
  - Budget < $0.08  → Sonnet (tuned)
  - Budget > $0.08  → Opus

RECOMMENDATION: Sonnet (tuned)
  Quality: 8.7/10 (97% of Opus)
  Cost: $0.046 (39% of Opus)
  Sweet spot: 👌
```

**Dynamic Model Routing:**

```yaml
# .karl/routing-rules.yaml
rules:
  - condition: "task_type == 'simple-fix' AND lines < 50"
    model: haiku
    reason: "Fast and cheap for small edits"

  - condition: "task_type == 'architecture' OR complexity > 8"
    model: opus
    reason: "Complex decisions need the big guns"

  - condition: "task_type == 'code-generation' AND tests_provided == true"
    model: sonnet
    reason: "Good balance with safety net"

  - default: sonnet
    reason: "Best all-around performer"
```

---

## 🎮 Gamification Ideas

### Achievement System 🏅

Unlock badges through usage:

- **First Ace** - First successful task
- **Hat Trick** - Three aces in a row
- **Century** - 100 tasks completed
- **Grand Slam** - All benchmarks passed in one day
- **Efficiency Expert** - 90%+ quality at < $0.01/task for a week
- **Speed Demon** - 10 tasks under 1 second each
- **Consensus Builder** - 50 multi-model consensus tasks
- **Tournament Champion** - Win a model tournament
- **Debate Master** - 10 successful debate convergences
- **Evolution Genius** - Improve skill by 20+ points through self-play
- **Cost Crusher** - Save $100 through optimization
- **Streak Legend** - 50-task win streak

### Daily Challenges 📅

```bash
karl daily
```

```
🎾 DAILY CHALLENGE - March 15, 2024

Today's Challenge: "Speed Round"
Complete 5 tasks in under 30 seconds total

Difficulty: ⭐⭐⭐☆☆
Reward: 2x XP, "Speed Demon" progress
Attempts: 3

[Start Challenge]
```

### XP and Leveling 📈

```
┌─────────────────────────────────────────────┐
│  KARL STATS                                 │
├─────────────────────────────────────────────┤
│  Level: 12 (Ace Server)                     │
│  XP: 8,450 / 10,000                         │
│  Rank: Amateur → Pro → Elite → Master       │
│                    ↑ You are here           │
├─────────────────────────────────────────────┤
│  Tasks Completed: 1,247                     │
│  Aces: 1,089 (87.3%)                        │
│  Perfect Games: 23                          │
│  Total Saved: $234.56                       │
├─────────────────────────────────────────────┤
│  Next Unlock: "Parallel Volley Mode" (Lvl 15)│
└─────────────────────────────────────────────┘
```

### Seasonal Leagues 🗓️

- **Spring Code Sprint** - Most tasks in March
- **Summer Optimization** - Best cost efficiency in June
- **Fall Quality Focus** - Highest quality scores in September
- **Winter Tournaments** - Multi-model competitions in December

### Social Features 👥

```bash
# Compare with friends
karl compare --friend @alice

# Share a winning solution
karl share --task-id abc123 --platform twitter

# Challenge someone
karl challenge --user @bob --task "Optimize this function"
```

---

## 🎾 Tennis-Themed Scoring

### Match Terminology

- **Love** (0) - Failed task
- **15** - Completed but low quality
- **30** - Good quality
- **40** - High quality
- **Game** - Perfect score (10/10)
- **Deuce** - Tie between models (requires advantage/judge)
- **Advantage** - Leading model in tournament
- **Set Point** - One task away from winning benchmark
- **Match Point** - Final task in tournament
- **Double Fault** - Two failed attempts (fallback to safer model)

### Court Types (Optimization Profiles)

- **Grass Court** - Speed priority (Haiku default)
- **Clay Court** - Endurance (long context, detailed tasks)
- **Hard Court** - Balanced (Sonnet default)
- **Indoor** - Precision (Opus default, controlled environment)

```bash
karl --court grass --task "Quick refactor"
# Uses speed-optimized settings

karl --court clay --task "Analyze 10k line codebase"
# Uses endurance settings (long context, patient processing)
```

---

## 🔧 Configuration

### Enable Competition Features

```yaml
# .karl/config.yaml
competition:
  enabled: true
  
  consensus:
    default_count: 3
    similarity_threshold: 0.85
    judge_model: opus
  
  tournaments:
    auto_save_winner: true
    min_contestants: 3
  
  scoring:
    weights:
      correctness: 0.30
      efficiency: 0.20
      clarity: 0.20
      cost: 0.15
      elegance: 0.15
  
  leaderboards:
    sync_community: true
    privacy: "pseudonymous"  # or "anonymous" or "public"
  
  gamification:
    enabled: true
    achievements: true
    daily_challenges: true
    xp_multiplier: 1.0
```

---

## 🚀 Advanced Examples

### 1. Critical Decision with Consensus

```bash
# Architectural decision
karl --consensus 5 --show-reasoning --save-decision \
  --task "Should we migrate from REST to GraphQL?"

# Security review with expert models
karl --consensus "opus:3,sonnet:2" \
  --skill security-expert \
  --task "Review authentication implementation"
```

### 2. Weekly Model Tournament

```bash
# Compare all models on your actual workload
karl tournament \
  --models all \
  --tasks ./tasks/weekly-sample.txt \
  --save-winner \
  --report weekly-tournament-report.md
```

### 3. A/B Test New Skill

```bash
# Test your custom skill vs default
karl ab \
  --variant-a "default" \
  --variant-b "skill:my-custom-skill" \
  --runs 10 \
  --task-file ./sample-tasks.txt \
  --report ab-test-results.json
```

### 4. Self-Play Skill Evolution

```bash
# Evolve a skill over weekend
karl self-play \
  --skill python-optimization \
  --iterations 20 \
  --benchmark ./benchmarks/python-perf.yaml \
  --convergence-threshold 0.95 \
  --log evolution.log
```

### 5. Cost Optimization Campaign

```bash
# Find optimal model for each task type
karl optimize \
  --analyze-history 30d \
  --min-quality 8.0 \
  --create-routing-rules \
  --dry-run
```

---

## 📊 Metrics & Analytics

### Track Everything

```bash
# Competition stats
karl stats --mode competition

# Model performance comparison
karl stats --compare-models --last 30d

# Skill effectiveness
karl stats --skills --sort-by improvement

# Cost savings from optimization
karl stats --cost-analysis --show-savings
```

### Export for Analysis

```bash
# Export to CSV for spreadsheet analysis
karl export --format csv --output competition-data.csv

# JSON for programmatic analysis
karl export --format json --include-all-metadata

# Markdown report for sharing
karl export --format markdown --output weekly-report.md
```

---

## 🎯 When to Use What

| Scenario | Feature | Command |
|----------|---------|---------|
| Critical decision | Consensus | `--consensus 3` |
| Find best model | Tournament | `tournament --models all` |
| Test changes | A/B Test | `ab --variant-a X --variant-b Y` |
| Improve skills | Self-play | `self-play --iterations 10` |
| Save money | Cost optimization | `optimize --budget N` |
| Track progress | Leaderboards | `leaderboard --user me` |
| Challenge yourself | Benchmarks | `benchmark --suite X` |
| Have fun | Daily challenges | `daily` |

---

## 🏁 Final Thoughts

Competition isn't just about winning—it's about continuous improvement. Karl competing with itself creates a feedback loop that makes every task a learning opportunity.

Like Ivo Karlović perfecting his serve through thousands of practice sessions, Karl gets better with every task, every tournament, every self-play session.

**Serve, score, improve, repeat.**

Now go rack up those aces. 🎾

---

## 📚 See Also

- [FEATURE_IDEAS.md](./FEATURE_IDEAS.md) - More features
- [README.md](./README.md) - Karl basics
- [SKILLS.md](./SKILLS.md) - Skill system
- [STACKS.md](./STACKS.md) - Model stacks

*Named after Ivo Karlović - because even at 6'11", he kept improving.*
