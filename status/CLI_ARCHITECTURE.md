# CLI Architecture

Core execution engine implementation in `packages/karl/src/`.

---

## Module Dependency Graph

```
┌─────────────────────────────────────────────────────┐
│                     cli.ts                          │
│              (Entry Point, 797 LOC)                 │
└───────────────┬─────────────────────────────────────┘
                │
                ├──> config.ts (166 LOC) - Load/merge config
                ├──> stacks.ts (288 LOC) - Stack loading
                ├──> context.ts (70 LOC) - System prompt building
                ├──> skills.ts (344 LOC) - Agent Skills
                ├──> hooks.ts (67 LOC) - Hook discovery
                │
                └──> scheduler.ts (110 LOC)
                     │
                     └──> runner.ts (302 LOC)
                          │
                          ├──> tools.ts (402 LOC)
                          └──> state.ts (79 LOC)
```

---

## Core Modules

### 1. cli.ts (Entry Point)

**Purpose:** Command routing, argument parsing, orchestration.

**Key Functions:**
- `main()` (lines 434-791) - Primary entry point
- `parseArgs(argv)` (lines 313-425) - CLI argument parsing
- `runStackCreationWizard()` (lines 65-193) - Interactive stack creation

**Command Dispatch:**
```typescript
if (firstArg === 'run') { /* ... */ }
else if (firstArg === 'init') { await handleInitCommand(); }
else if (BUILTIN_COMMANDS.has(firstArg)) { /* ... */ }
else {
  // Stack-as-verb resolution
  const isStack = await stackExists(firstArg);
  if (isStack) { /* use stack */ }
  else { await runStackCreationWizard(firstArg, args); }
}
```

---

### 2. runner.ts (Task Execution)

**Purpose:** Execute tasks via pi-ai agent loop.

**Key Function:** `runTask(params: RunTaskParams)`

**Control Flow:**
1. Emit `task_start` event
2. Run `pre-task` hooks
3. Build tool array
4. Map provider to pi-ai format
5. Run agent loop with timeout
6. Emit `task_complete` event
7. Run `post-task` hooks

**Timeout Enforcement:**
```typescript
async function runWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs?: number,
  controller?: AbortController
): Promise<T>
```

---

### 3. scheduler.ts (Parallel Execution)

**Purpose:** Manage parallel tasks with retry logic.

**Class:** `VolleyScheduler`

**Work-stealing queue pattern:**
```typescript
while (active < maxConcurrent && queue.length > 0) {
  const item = queue.shift();
  active++;
  runTask(item)
    .catch(error => {
      if (isRetryable(error) && attempt < retryAttempts) {
        queue.push({ ...item, attempt: attempt + 1 });
      }
    })
    .finally(() => { active--; pump(); });
}
```

**Retry Logic:**
- Retryable errors: 408, 429, 500-504, timeouts
- Exponential backoff: 1s -> 2s -> 4s (max 60s)
- Max 3 attempts per task

---

### 4. tools.ts (Tool System)

**Purpose:** Built-in tools and custom tool loading.

**Built-in Tools:**

| Tool | Description |
|------|-------------|
| `bash` | Execute shell commands |
| `read` | Read files (text + images) |
| `write` | Create/overwrite files |
| `edit` | Find/replace text |

**Wrapper Pattern:**
```typescript
function wrapExecute(name, execute, ctx) {
  return async (toolCallId, params) => {
    ctx.onEvent({ type: 'tool_start', ... });
    await ctx.hooks.run('pre-tool', ...);
    try {
      const result = await execute(params);
      await ctx.hooks.run('post-tool', { success: true });
      return result;
    } catch (error) {
      await ctx.hooks.run('on-error', { scope: 'tool' });
      throw error;
    }
  };
}
```

**Sandbox Enforcement:**
```typescript
function assertWithinCwd(resolved: string, cwd: string) {
  if (!resolved.startsWith(cwd + path.sep)) {
    throw new Error(`Operation outside working directory not allowed`);
  }
}
```

---

### 5. state.ts (State Management)

**Purpose:** Event-driven state tracking.

**Functions:**
- `initState(tasks)` - Create initial volley state
- `applyEvent(state, event)` - Reducer for events

**Event Types:**
- `task_start` - Set status to 'running'
- `tool_start` - Add tool to tools array
- `tool_end` - Update tool status
- `task_complete` - Record result
- `task_error` - Record error
- `task_retry` - Reset for retry

---

## Data Structures

### CliOptions
```typescript
interface CliOptions {
  model?: string;
  verbose?: boolean;
  json?: boolean;
  maxConcurrent?: number;
  timeoutMs?: number;
  skill?: string;
  noTools?: boolean;
  unrestricted?: boolean;
  context?: string;
  stack?: string;
  volley?: boolean;
}
```

### TaskResult
```typescript
interface TaskResult {
  task: string;
  status: 'success' | 'error';
  result?: string;
  error?: string;
  durationMs: number;
  toolsUsed: string[];
  tokens?: TokenUsage;
}
```

### SchedulerEvent (Discriminated Union)
```typescript
type SchedulerEvent =
  | { type: 'task_start'; taskIndex: number; task: string; time: number }
  | { type: 'tool_start'; taskIndex: number; tool: string; time: number }
  | { type: 'task_complete'; result: string; durationMs: number; ... }
  | { type: 'task_error'; error: string; durationMs: number; ... }
  | { type: 'task_retry'; attempt: number; delayMs: number; ... };
```

---

## Design Patterns

### 1. Event-Driven State Management
Unidirectional data flow with reducer-style event application.

### 2. Dependency Injection
Pass dependencies as function parameters for testability.

### 3. Wrapper Pattern for Tools
Universal wrapper adds events and hooks to all tool executions.

### 4. Multi-Layer Config Merging
Deep merge with priority: Folder > Project > Global > Default.

### 5. Work-Stealing Queue
Dynamic task distribution with retry queueing.

---

## Control Flow

```
User Input: karl run "task"
     │
     ├─> parseArgs() -> { options, tasks }
     ├─> loadConfig() -> merge configs
     ├─> resolveModel() -> provider & model
     ├─> buildSystemPrompt() -> assemble context
     │
     ├─> scheduler.run([task], runTask)
     │    │
     │    └─> runTask()
     │         ├─> hooks.run('pre-task')
     │         ├─> agentLoop()
     │         │    └─> tool calls
     │         ├─> hooks.run('post-task')
     │         └─> return TaskResult
     │
     └─> printResults()
```
