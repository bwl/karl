# Metrics Dashboard

> "You can't improve what you don't measure." - But in Karl's case, you can at least serve faster.

## Overview

Karl should track usage metrics locally to help users understand their AI usage patterns, optimize costs, and improve productivity. This is **local-first by design** - your data never leaves your machine unless you explicitly export it.

## Philosophy

- **🎾 Track Your Aces**: Know which tasks are one-shot completions
- **📊 Local-Only**: SQLite database, no cloud telemetry
- **⚡ Fast Queries**: Instant insights without slowing down serves
- **🔒 Privacy-First**: Opt-in, exportable, deletable
- **💰 Cost-Aware**: Track spending across providers

---

## What to Track

### Core Metrics

```typescript
interface TaskMetric {
  // Identity
  id: string;                    // UUID for this task
  timestamp: Date;               // When the task started
  
  // Task Details
  command: string;               // The karl command used
  prompt: string;                // User's prompt (truncated/hashed?)
  result: 'success' | 'error' | 'timeout';
  duration_ms: number;           // Total execution time
  
  // Model & Stack
  model: string;                 // e.g., 'claude-3-5-sonnet-20241022'
  stack: string;                 // e.g., 'sonnet', 'trinity'
  provider: string;              // 'anthropic', 'openai', 'local'
  
  // Token Usage
  tokens_input: number;          // Prompt tokens
  tokens_output: number;         // Completion tokens
  tokens_cache_write?: number;   // Cache creation (Anthropic)
  tokens_cache_read?: number;    // Cache hits (Anthropic)
  
  // Cost
  cost_usd: number;              // Total cost in USD
  cost_breakdown: {
    input: number;
    output: number;
    cache_write: number;
    cache_read: number;
  };
  
  // Context & Skills
  skills_used: string[];         // e.g., ['typescript', 'testing']
  context_files: number;         // Number of files in context
  context_size_bytes: number;    // Total context size
  
  // Tool Usage
  tool_calls: {
    name: string;                // 'bash', 'read', 'write', 'edit'
    count: number;               // How many times called
  }[];
  
  // Environment
  working_directory: string;     // Where karl was run
  git_repo?: string;             // Git remote if in repo
  
  // Metadata
  karl_version: string;          // Which version of karl
  tags?: string[];               // User-defined tags
}
```

### Session Metrics

Track grouped work sessions (similar volleys):

```typescript
interface SessionMetric {
  id: string;
  start: Date;
  end: Date;
  task_count: number;
  total_cost: number;
  total_tokens: number;
  dominant_skill?: string;       // Most-used skill
  dominant_model?: string;       // Most-used model
}
```

### Aggregate Metrics

Pre-computed rollups for fast dashboards:

```typescript
interface DailyAggregate {
  date: string;                  // YYYY-MM-DD
  task_count: number;
  total_cost: number;
  total_tokens: number;
  unique_models: number;
  unique_skills: number;
  avg_duration_ms: number;
  success_rate: number;          // % of successful tasks
}
```

---

## Storage Design

### SQLite Schema

Local-first, portable, fast, embeddable.

```sql
-- Main tasks table
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  command TEXT NOT NULL,
  prompt_hash TEXT,              -- SHA256 of prompt for privacy
  prompt_preview TEXT,           -- First 100 chars
  result TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  
  model TEXT NOT NULL,
  stack TEXT NOT NULL,
  provider TEXT NOT NULL,
  
  tokens_input INTEGER NOT NULL,
  tokens_output INTEGER NOT NULL,
  tokens_cache_write INTEGER,
  tokens_cache_read INTEGER,
  
  cost_usd REAL NOT NULL,
  cost_input REAL,
  cost_output REAL,
  cost_cache_write REAL,
  cost_cache_read REAL,
  
  context_files INTEGER,
  context_size_bytes INTEGER,
  
  working_directory TEXT,
  git_repo TEXT,
  karl_version TEXT NOT NULL,
  
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX idx_tasks_timestamp ON tasks(timestamp);
CREATE INDEX idx_tasks_model ON tasks(model);
CREATE INDEX idx_tasks_stack ON tasks(stack);
CREATE INDEX idx_tasks_result ON tasks(result);

-- Skills used per task (many-to-many)
CREATE TABLE task_skills (
  task_id TEXT NOT NULL,
  skill TEXT NOT NULL,
  PRIMARY KEY (task_id, skill),
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX idx_task_skills_skill ON task_skills(skill);

-- Tool calls per task
CREATE TABLE task_tools (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  call_count INTEGER NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX idx_task_tools_task ON task_tools(task_id);

-- Sessions (optional, for grouping)
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  start_time INTEGER NOT NULL,
  end_time INTEGER,
  task_count INTEGER DEFAULT 0,
  total_cost REAL DEFAULT 0,
  total_tokens INTEGER DEFAULT 0
);

-- Daily aggregates for fast queries
CREATE TABLE daily_aggregates (
  date TEXT PRIMARY KEY,
  task_count INTEGER,
  total_cost REAL,
  total_tokens INTEGER,
  unique_models INTEGER,
  unique_skills INTEGER,
  avg_duration_ms REAL,
  success_rate REAL,
  last_updated INTEGER DEFAULT (unixepoch())
);

-- User preferences and budgets
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Budget tracking
CREATE TABLE budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,           -- 'daily', 'weekly', 'monthly'
  limit_usd REAL NOT NULL,
  period_start INTEGER NOT NULL,
  period_end INTEGER NOT NULL,
  spent_usd REAL DEFAULT 0,
  alert_threshold REAL          -- Alert at 80% by default
);
```

### Database Location

```bash
~/.karl/metrics.db              # Main metrics database
~/.karl/metrics.db-wal          # WAL file for concurrent access
~/.karl/metrics.db-shm          # Shared memory file
```

---

## CLI Commands

### Basic Stats

```bash
# Overall summary
karl stats

# Output:
# 🎾 Karl Stats
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 
# 📊 All Time
#   Tasks:        1,247 (98.2% success)
#   Tokens:       12.4M (input) + 3.2M (output)
#   Cost:         $127.45
#   Avg Duration: 2.3s
# 
# 🗓️  This Week
#   Tasks:        89
#   Cost:         $8.92 (12% vs last week)
# 
# 🎯 Top Models
#   1. claude-3-5-sonnet (892 tasks, $98.21)
#   2. claude-3-haiku    (245 tasks, $12.34)
#   3. gpt-4o            (110 tasks, $16.90)
# 
# 🔧 Top Skills
#   1. typescript (445 tasks)
#   2. debugging  (234 tasks)
#   3. testing    (189 tasks)
# 
# 🏆 Best Ace: One-shot deploy script (0.8s, $0.02)
```

### Time-Based Queries

```bash
# Pre-defined periods
karl stats --today
karl stats --yesterday
karl stats --this-week
karl stats --last-week
karl stats --this-month
karl stats --last-month
karl stats --this-year

# Custom ranges
karl stats --from 2024-01-01 --to 2024-01-31
karl stats --last 30d
karl stats --last 100    # Last 100 tasks
```

### Filtering

```bash
# By model
karl stats --model sonnet
karl stats --model opus --this-month

# By skill
karl stats --skill typescript
karl stats --skill "debugging,testing"

# By result
karl stats --errors              # Only failed tasks
karl stats --success-rate        # Success % over time

# By project
karl stats --repo myproject
karl stats --dir ~/code/karl
```

### Detailed Views

```bash
# Cost breakdown
karl stats cost --this-month
# Output:
# 💰 Cost Breakdown (December 2024)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 
# Total: $42.18
# 
# By Model:
#   claude-3-5-sonnet  $32.45  (77%)  ████████████████████
#   claude-3-haiku     $6.23   (15%)  ████
#   gpt-4o             $3.50   (8%)   ██
# 
# By Component:
#   Input tokens       $8.44   (20%)
#   Output tokens      $31.20  (74%)
#   Cache writes       $1.89   (4%)
#   Cache reads        $0.65   (2%)
# 
# Daily Trend:
#   Dec 1  ▁ $0.80
#   Dec 2  ▃ $1.20
#   Dec 3  █ $3.40
#   ...

# Token usage
karl stats tokens --this-week
karl stats tokens --by-model

# Performance analysis
karl stats perf
# Shows:
# - Average duration by model
# - Slowest tasks
# - Cache hit rates
# - Tool call frequency

# Task history
karl stats history --limit 20
karl stats history --model opus --last 10
```

### Leaderboards

```bash
# Most expensive tasks
karl stats top --cost

# Fastest completions
karl stats top --speed

# Longest running
karl stats top --duration

# Most cache-efficient
karl stats top --cache-efficiency
```

---

## Budget Management

### Setting Budgets

```bash
# Set daily budget
karl budget daily 5.00
# Output: ✓ Daily budget set to $5.00

# Set weekly/monthly
karl budget weekly 25.00
karl budget monthly 100.00

# Alert thresholds
karl budget daily 5.00 --alert-at 0.80  # Alert at 80%
```

### Budget Status

```bash
karl budget status

# Output:
# 💰 Budget Status
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 
# Today:        $2.34 / $5.00   (47%) ████████░░░░░░░░
# This Week:    $12.18 / $25.00 (49%) █████████░░░░░░░
# This Month:   $42.18 / $100   (42%) ████████░░░░░░░░
# 
# ✓ All budgets healthy
```

### Budget Alerts

When threshold reached during a task:

```bash
⚠️  Budget Alert: Daily budget at 82% ($4.10 / $5.00)
   Continue? [y/N]
```

### Budget History

```bash
karl budget history --this-month

# Shows daily spending chart and budget compliance
```

---

## Insights & Analysis

### Automatic Insights

Karl should generate insights automatically:

```bash
karl insights

# Output:
# 💡 Karl Insights
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 
# Cost Optimization:
#   ↓ 23% of your tasks could use 'cliffy' instead of 'sonnet'
#     Potential savings: $4.20/week
# 
# Performance:
#   ↑ Cache hit rate improved 15% this week
#   → Your context patterns are getting more efficient
# 
# Usage Patterns:
#   🎯 Peak productivity: Tuesdays 10am-12pm
#   🎯 Best ace rate: Early morning (94% success)
# 
# Skills:
#   📚 You haven't used 'docker' skill in 30 days
#   ⭐ 'typescript' skill has 98% success rate
# 
# Suggestions:
#   • Consider using volley mode for parallel tasks
#   • Your context size is optimal (avg 45KB)
#   • Try the new 'trinity' stack for multi-model tasks
```

### Comparative Analysis

```bash
# Compare time periods
karl compare --this-week --last-week

# Output:
# 📊 Week Comparison
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 
#                    This Week    Last Week    Change
# Tasks              89           76           +17% ↑
# Cost               $8.92        $10.12       -12% ↓
# Avg Duration       2.1s         2.8s         -25% ↓
# Success Rate       98%          95%          +3%  ↑
# Cache Hit Rate     34%          28%          +6%  ↑
# 
# 💡 You're spending less but completing more tasks!

# Compare models
karl compare --models sonnet,opus,cliffy
```

### Trends

```bash
karl trends --cost --last 30d
karl trends --performance --this-year
karl trends --skills --this-month

# Visual trend charts in terminal (using sparklines or blocks)
```

---

## Export Formats

### JSON Export

```bash
# Export all data
karl export --format json > metrics.json

# Export specific period
karl export --this-month --format json > december.json

# Filtered export
karl export --model sonnet --skill typescript --format json

# Pretty print
karl export --format json --pretty
```

Example JSON structure:

```json
{
  "export_date": "2024-12-19T10:30:00Z",
  "karl_version": "1.0.0",
  "period": {
    "from": "2024-12-01",
    "to": "2024-12-31"
  },
  "summary": {
    "task_count": 89,
    "total_cost": 8.92,
    "total_tokens": 1234567,
    "success_rate": 0.982
  },
  "tasks": [
    {
      "id": "task_abc123",
      "timestamp": "2024-12-19T10:15:00Z",
      "command": "karl --skill typescript 'add tests'",
      "result": "success",
      "duration_ms": 2340,
      "model": "claude-3-5-sonnet-20241022",
      "tokens": {
        "input": 12450,
        "output": 3210,
        "cache_read": 8900
      },
      "cost": 0.23,
      "skills": ["typescript", "testing"]
    }
  ]
}
```

### CSV Export

```bash
karl export --format csv > metrics.csv
karl export --format csv --fields timestamp,model,cost,duration_ms
```

Great for Excel or data science tools:

```csv
timestamp,model,cost,duration_ms,tokens_total,result,skills
2024-12-19T10:15:00Z,claude-3-5-sonnet,0.23,2340,15660,success,"typescript,testing"
2024-12-19T09:45:00Z,claude-3-haiku,0.02,890,4500,success,debugging
```

### SQLite Export

```bash
# Export just the database
karl export --format sqlite --output backup.db

# Export specific tables
karl export --format sqlite --tables tasks,task_skills
```

### Markdown Reports

```bash
karl export --format markdown > report.md

# Generates a readable report:
# # Karl Metrics Report
# Generated: 2024-12-19
# 
# ## Summary
# - Total Tasks: 89
# - Success Rate: 98.2%
# - Total Cost: $8.92
# ...
```

---

## External Dashboard Integration

### Prometheus Metrics

Expose metrics in Prometheus format:

```bash
# Start metrics server
karl metrics serve --port 9090

# Scrape endpoint at http://localhost:9090/metrics
```

Example metrics:

```prometheus
# HELP karl_tasks_total Total number of tasks executed
# TYPE karl_tasks_total counter
karl_tasks_total{model="claude-3-5-sonnet",result="success"} 892

# HELP karl_cost_usd_total Total cost in USD
# TYPE karl_cost_usd_total counter
karl_cost_usd_total{model="claude-3-5-sonnet"} 98.21

# HELP karl_task_duration_seconds Task execution duration
# TYPE karl_task_duration_seconds histogram
karl_task_duration_seconds_bucket{model="claude-3-5-sonnet",le="1"} 234
karl_task_duration_seconds_bucket{model="claude-3-5-sonnet",le="5"} 789
```

### Grafana Dashboard

Provide a sample Grafana dashboard JSON:

```bash
karl export --format grafana > grafana-dashboard.json

# Import into Grafana to visualize:
# - Task volume over time
# - Cost trends by model
# - Success rates
# - Cache efficiency
# - Token usage patterns
```

### webhooks

Send metrics to external services:

```bash
# Configure webhook
karl config set metrics.webhook.url "https://api.mycompany.com/metrics"
karl config set metrics.webhook.on "task_complete"

# Payload sent:
# POST /metrics
# {
#   "event": "task_complete",
#   "task_id": "task_abc123",
#   "timestamp": "2024-12-19T10:15:00Z",
#   "model": "claude-3-5-sonnet",
#   "cost": 0.23,
#   "duration_ms": 2340,
#   "result": "success"
# }
```

### Custom Scripts

Make it easy to pipe data to custom analytics:

```bash
# Stream new tasks to a script
karl metrics stream | jq -r '.cost' | my-custom-logger

# Watch for expensive tasks
karl metrics stream --filter 'cost > 1.0' | alert-me

# Real-time dashboard
karl metrics stream | python dashboard.py
```

---

## Privacy & Control

### Opt-In System

Metrics collection is **opt-in** by default:

```bash
# First time setup
karl init

# Prompt:
# 📊 Enable usage metrics?
#    Karl can track your tasks locally to help optimize costs and performance.
#    
#    • All data stays on your machine
#    • No telemetry sent to cloud
#    • Can export or delete anytime
#    
#    Enable metrics? [Y/n]
```

### Privacy Modes

```bash
# Disable all tracking
karl config set metrics.enabled false

# Hash prompts (don't store full text)
karl config set metrics.hash_prompts true

# Only track aggregates (no individual tasks)
karl config set metrics.aggregate_only true

# Exclude sensitive directories
karl config set metrics.exclude_dirs "/secrets,/private"
```

### Data Retention

```bash
# Set retention policy
karl config set metrics.retention_days 90

# Clean old data
karl metrics clean --older-than 90d
karl metrics clean --before 2024-01-01

# Delete all metrics
karl metrics delete --all --confirm
```

### What's Tracked vs Not

**Always Local:**
- Task execution data
- Token usage
- Cost calculations
- Skill/model usage
- Performance metrics

**Never Tracked:**
- File contents
- Full prompts (unless opt-in)
- API keys or secrets
- User identity (no account ID)
- Git commit messages

**Optional:**
- Full prompt text (default: hash only)
- File paths (default: anonymize)
- Git repo names (default: track)

---

## Implementation Notes

### Performance Considerations

```typescript
// Fast metrics recording (async, non-blocking)
class MetricsCollector {
  private db: Database;
  private writeQueue: TaskMetric[] = [];
  
  async record(metric: TaskMetric) {
    // Queue write, don't block task completion
    this.writeQueue.push(metric);
    
    // Batch writes every 100ms
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), 100);
    }
  }
  
  private async flush() {
    const batch = this.writeQueue.splice(0);
    await this.db.transaction(() => {
      for (const metric of batch) {
        this.insertMetric(metric);
      }
      this.updateAggregates();
    });
  }
}
```

### Cost Calculation

Track pricing per model in config:

```typescript
interface ModelPricing {
  model: string;
  pricing: {
    input_per_mtok: number;      // $ per 1M tokens
    output_per_mtok: number;
    cache_write_per_mtok?: number;
    cache_read_per_mtok?: number;
  };
  effective_date: string;        // Track pricing changes
}

// Auto-update pricing from providers
karl pricing update
```

### Migration & Versioning

```typescript
// Schema migrations for future changes
const migrations = [
  {
    version: 1,
    up: (db) => { /* initial schema */ },
    down: (db) => { /* rollback */ }
  },
  {
    version: 2,
    up: (db) => { /* add new column */ },
    down: (db) => { /* remove column */ }
  }
];
```

---

## Future Ideas

### Advanced Analytics

- **ML-based suggestions**: "Model X is better for tasks like this"
- **Anomaly detection**: "This task cost 10x more than usual"
- **Skill effectiveness**: Which skills lead to fastest/cheapest results?
- **Context optimization**: Suggest which files to include/exclude

### Collaboration Features

```bash
# Share anonymized stats with team
karl stats share --team --anonymize

# Compare with team averages
karl stats compare --team-average

# Team leaderboards (fun!)
karl stats leaderboard --team --metric aces
```

### Time Tracking Integration

```bash
# Integrate with time tracking tools
karl config set metrics.toggl.token "..."
karl stats --export-to-toggl --this-week
```

### Carbon Footprint

```bash
# Estimate carbon impact
karl stats carbon --this-month

# Output:
# 🌍 Carbon Footprint
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 
# Estimated CO2: 2.3 kg (this month)
# Equivalent to: 9.2 miles driven
# 
# By provider:
#   Anthropic (AWS):  1.8 kg
#   OpenAI (Azure):   0.5 kg
# 
# 💡 Using cached tokens saves ~0.4 kg CO2/month
```

### Smart Notifications

```bash
# Desktop notifications for milestones
karl config set metrics.notify.on "milestone,budget_alert"

# Notification examples:
# 🎾 Milestone: 1,000 tasks completed!
# ⚠️  Budget alert: 80% of daily budget used
# 🏆 New record: Fastest completion (0.8s)
# 💰 You saved $12 this week with caching!
```

---

## CLI Examples in Action

### Daily Workflow

```bash
# Morning: Check yesterday's work
karl stats --yesterday

# During work: Quick cost check
karl stats cost --today

# End of week: Full review
karl stats --this-week
karl insights
karl budget status

# End of month: Export for records
karl export --this-month --format json > invoices/karl-dec-2024.json
```

### Optimization Workflow

```bash
# Find expensive tasks
karl stats top --cost --limit 10

# Analyze what made them expensive
karl stats history --id task_abc123 --verbose

# See if cheaper model would work
karl insights --suggest-model-downgrade

# Test with cheaper model
karl --stack cliffy "same prompt"

# Compare results
karl stats compare --tasks task_abc123,task_xyz789
```

### Team Lead Workflow

```bash
# Weekly team report
karl export --this-week --format markdown > reports/week-50.md

# Cost breakdown by project
karl stats cost --by-repo --this-month

# Identify optimization opportunities
karl insights --team-mode > insights.txt

# Share learnings
git add reports/ insights.txt && git commit -m "Week 50 Karl metrics"
```

---

## Summary

The metrics dashboard makes Karl **self-aware** and helps users:

1. **💰 Control costs** with budgets and alerts
2. **📊 Understand patterns** with automatic insights  
3. **⚡ Optimize performance** by tracking what works
4. **🔒 Maintain privacy** with local-only storage
5. **🎯 Improve productivity** by learning from history

All while keeping Karl fast, Unix-native, and respectful of your data.

**Track your aces. Serve better.** 🎾
