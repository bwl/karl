# Cliffy Stack

How to build Cliffy using the [pi-mono](https://github.com/badlogic/pi-mono) packages.

## The Pi Packages We'd Use

```
┌─────────────────────────────────────────────────────────┐
│                     cliffy-cli                          │
│              (volley scheduler, ace UX)                 │
├─────────────────────────────────────────────────────────┤
│     pi-tui          │         pi-agent                  │
│  (flicker-free UI)  │  (tool loop, state management)    │
├─────────────────────┴───────────────────────────────────┤
│                       pi-ai                             │
│        (unified LLM API: OpenAI, Anthropic, etc.)       │
└─────────────────────────────────────────────────────────┘
```

| Package | What Cliffy Uses It For |
|---------|-------------------------|
| `@mariozechner/pi-ai` | Provider abstraction, streaming, tool schemas |
| `@mariozechner/pi-agent` | Agent loop, tool execution, message handling |
| `@mariozechner/pi-tui` | Differential rendering for ephemeral TUI |

## pi-ai: Provider Layer

Handles the LLM API complexity so we don't have to.

```typescript
import { createProvider, streamChat } from '@mariozechner/pi-ai';

// Configure providers
const anthropic = createProvider({
  type: 'anthropic',
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const openrouter = createProvider({
  type: 'openai',
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
});

// Stream a response
const stream = streamChat(anthropic, {
  model: 'claude-sonnet-4-20250514',
  messages: [{ role: 'user', content: 'Hello' }],
  tools: [/* tool definitions */],
});

for await (const event of stream) {
  if (event.type === 'content_delta') {
    // Handle streaming text
  } else if (event.type === 'tool_use') {
    // Handle tool call
  }
}
```

**What we get for free:**
- OpenAI, Anthropic, Google, OpenRouter, Ollama, vLLM support
- Consistent streaming interface across providers
- Tool/function calling normalization
- Token counting
- Error handling (rate limits, retries)

## pi-agent: Agent Loop

The core "think → act → observe" cycle.

```typescript
import { Agent, defineTool } from '@mariozechner/pi-agent';

// Define tools
const readTool = defineTool({
  name: 'read',
  description: 'Read file contents',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path' }
    },
    required: ['path']
  },
  execute: async ({ path }) => {
    return await Bun.file(path).text();
  }
});

// Create agent
const agent = new Agent({
  provider: anthropic,
  model: 'claude-sonnet-4-20250514',
  tools: [readTool, writeTool, editTool, bashTool],
  systemPrompt: loadedContext,
});

// Run to completion
const result = await agent.run('analyze auth.go for security issues');
```

**What we get for free:**
- Tool call → execute → feed result loop
- Message history management
- Streaming with tool interleaving
- Abort/cancellation support

**What we build on top:**
- One-shot execution (no session persistence)
- Volley scheduler (parallel agents)
- Event hooks for TUI updates

## pi-tui: Ephemeral Interface

Flicker-free differential rendering. Key for the Ace Model.

```typescript
import { Screen, Box, Text, render } from '@mariozechner/pi-tui';

// Create a screen (alternate buffer)
const screen = new Screen({ altBuffer: true });

// Define UI components
function TaskRow({ task, status, tools }) {
  return Box({ border: 'none' }, [
    Text(`${status.icon} ${task.name}`),
    ...tools.map(t => Text(`  ├───${t.icon} ${t.name}`))
  ]);
}

function VolleyUI({ tasks }) {
  return Box({ border: 'single' }, [
    Text('◍ cliffy volley'),
    ...tasks.map(t => TaskRow(t)),
    ProgressBar({ value: completedCount / totalCount })
  ]);
}

// Render loop (differential - only redraws changes)
function update(state) {
  render(screen, VolleyUI(state));
}

// On completion: exit alternate buffer, print results
screen.exit();
console.log(formatResults(results));
```

**What we get for free:**
- Alternate screen buffer (TUI vanishes cleanly)
- Differential rendering (no flicker)
- Unicode box drawing
- Responsive to terminal resize

**Key pattern for Ace Model:**
```typescript
async function runWithTUI(task) {
  const screen = new Screen({ altBuffer: true });
  
  try {
    // TUI phase
    for await (const event of agent.stream(task)) {
      updateTUI(screen, event);
    }
  } finally {
    // Always exit cleanly
    screen.exit();
  }
  
  // Print phase
  console.log(formatResult(result));
}
```

## Cliffy-Specific Code

What we build that's NOT in pi:

### 1. Volley Scheduler

Parallel task execution with worker pool:

```typescript
class VolleyScheduler {
  constructor(private maxConcurrent: number = 3) {}
  
  async run(tasks: string[], agent: AgentConfig): Promise<Result[]> {
    const results: Result[] = new Array(tasks.length);
    const queue = tasks.map((task, i) => ({ task, index: i }));
    const active = new Map<number, Promise<void>>();
    
    while (queue.length > 0 || active.size > 0) {
      // Fill worker slots
      while (queue.length > 0 && active.size < this.maxConcurrent) {
        const { task, index } = queue.shift()!;
        const promise = this.runTask(task, index, results);
        active.set(index, promise);
        promise.finally(() => active.delete(index));
      }
      
      // Wait for any to complete
      if (active.size > 0) {
        await Promise.race(active.values());
      }
    }
    
    return results;
  }
  
  private async runTask(task: string, index: number, results: Result[]) {
    const agent = new Agent(this.config);
    
    try {
      const result = await agent.run(task);
      results[index] = { status: 'success', result };
    } catch (error) {
      if (isRetryable(error)) {
        // Re-queue with backoff
        await sleep(backoff(this.retryCount));
        queue.push({ task, index });
      } else {
        results[index] = { status: 'error', error };
      }
    }
  }
}
```

### 2. TUI State Machine

Coordinating multiple task displays:

```typescript
interface VolleyState {
  tasks: TaskState[];
  startTime: number;
}

interface TaskState {
  index: number;
  prompt: string;
  status: 'queued' | 'running' | 'done' | 'error';
  tools: ToolTrace[];
  result?: string;
  elapsed?: number;
}

// Event handler updates state, triggers re-render
function handleAgentEvent(state: VolleyState, taskIndex: number, event: AgentEvent) {
  const task = state.tasks[taskIndex];
  
  switch (event.type) {
    case 'start':
      task.status = 'running';
      break;
    case 'tool_start':
      task.tools.push({ name: event.tool, status: 'running' });
      break;
    case 'tool_end':
      task.tools.at(-1)!.status = event.success ? 'done' : 'error';
      break;
    case 'complete':
      task.status = 'done';
      task.result = event.result;
      task.elapsed = Date.now() - task.startTime;
      break;
    case 'error':
      task.status = 'error';
      task.error = event.error;
      break;
  }
  
  renderTUI(state);
}
```

### 3. Clean Exit & Print

The Ace landing:

```typescript
async function cliffy(tasks: string[], options: Options) {
  const screen = new Screen({ altBuffer: true });
  const state = initState(tasks);
  
  try {
    if (!options.quiet) {
      renderTUI(screen, state);
    }
    
    const scheduler = new VolleyScheduler(options.maxConcurrent);
    
    scheduler.on('event', (taskIndex, event) => {
      handleAgentEvent(state, taskIndex, event);
      if (!options.quiet) {
        renderTUI(screen, state);
      }
    });
    
    const results = await scheduler.run(tasks);
    
    return results;
    
  } finally {
    // Exit TUI
    if (!options.quiet) {
      screen.exit();
    }
  }
  
  // Print results
  printResults(results, options);
}
```

### 4. Skills Loader

```typescript
async function loadSkill(name: string): Promise<string> {
  const paths = [
    `.cliffy/skills/${name}.md`,
    `~/.config/cliffy/skills/${name}.md`,
  ];
  
  for (const path of paths) {
    if (await exists(path)) {
      return await Bun.file(path).text();
    }
  }
  
  throw new Error(`Skill not found: ${name}`);
}

// Prepend to system prompt
const systemPrompt = [
  await loadContextFiles(),
  options.skill ? await loadSkill(options.skill) : '',
  options.context ?? '',
].filter(Boolean).join('\n\n');
```

## Package Structure

```
cliffy/
├── packages/
│   └── cliffy/
│       ├── src/
│       │   ├── cli.ts           # Entry point, arg parsing
│       │   ├── scheduler.ts     # Volley scheduler
│       │   ├── tui.ts           # TUI components & state
│       │   ├── tools.ts         # Built-in tool definitions
│       │   ├── skills.ts        # Skill loader
│       │   ├── hooks.ts         # Hook system
│       │   ├── config.ts        # Config loading
│       │   └── print.ts         # Result formatting
│       ├── package.json
│       └── tsconfig.json
├── package.json                 # Workspace root
└── README.md
```

Single package for now. Split later if needed.

## Dependencies

```json
{
  "dependencies": {
    "@mariozechner/pi-ai": "^0.8.0",
    "@mariozechner/pi-agent": "^0.8.0",
    "@mariozechner/pi-tui": "^0.8.0"
  },
  "devDependencies": {
    "bun-types": "latest",
    "typescript": "^5.0.0"
  }
}
```

## Build & Distribution

```bash
# Development
bun run src/cli.ts "test task"

# Build binary
bun build src/cli.ts --compile --outfile dist/cliffy

# The binary is self-contained, no node_modules needed
```

## What We're NOT Using from Pi

| Package | Why Not |
|---------|---------|
| `pi-coding-agent` | We're building our own CLI with different UX |
| `pi-mom` | Slack bot, not relevant |
| `pi-web-ui` | Web components, not relevant |
| `pi-proxy` | Browser CORS proxy, not relevant |
| `pi (pods)` | GPU pod management, not relevant |

## Open Questions

1. **Fork pi-tui or depend on it?** 
   - Depend: less code to maintain, benefit from updates
   - Fork: can slim down, customize for Cliffy's specific needs

2. **How much of pi-agent to use?**
   - Full agent: get tool loop for free
   - Just pi-ai: more control, build our own minimal loop
   - Leaning toward full pi-agent, it's well-designed

3. **TypeScript or Rust?**
   - TS + Bun: fast iteration, pi packages ready to use
   - Rust: faster binary, but rebuild everything
   - Start with TS, port to Rust later if needed for speed

4. **Versioning strategy?**
   - Track pi-mono versions? 
   - Or pin and update deliberately?
   - Probably pin + deliberate updates
