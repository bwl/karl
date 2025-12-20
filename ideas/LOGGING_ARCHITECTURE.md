# Karl Logging Architecture

## 1. Current State

### What Exists
- **Console-based output**: Direct `console.log/error/warn` calls scattered across modules
- **Print utilities** (`print.ts`): Basic formatters for task results, errors, and JSON output
  - `printResult()`: Formats single task results with token stats in verbose mode
  - `printSchedulerResults()`: Batch result formatting
  - `printError()`: Error formatting with optional JSON output
- **Verbose flag**: CLI option that enables additional output (token usage, timing)
- **JSON output flag**: Structured output for programmatic consumption
- **Spinner utility** (`spinner.ts`): Visual feedback during operations

### What's Missing
- **Structured logging**: No consistent log format or metadata
- **Log levels**: No DEBUG, INFO, WARN, ERROR hierarchy
- **Performance tracking**: No detailed timing breakdowns
- **Cost tracking**: Token usage exists but not aggregated or persisted
- **Correlation IDs**: No way to trace related operations
- **File output**: Logs only go to stdout/stderr
- **Remote logging**: No integration with observability platforms
- **Hook logging**: No standardized way for hooks to emit logs
- **Tool execution logs**: Limited visibility into tool calls

## 2. Requirements

### Debugging Requirements
- **Trace task execution flow**: From CLI args → runner → tools → completion
- **Correlate operations**: Link scheduler volleys, retries, and individual tasks
- **Tool execution details**: Input/output for each tool call with timing
- **Hook lifecycle**: Pre/post execution with context
- **Error context**: Full stack traces with request/response data

### Monitoring Requirements
- **Performance metrics**:
  - Task execution time (queue, execution, total)
  - Tool execution time per tool type
  - API latency by provider/model
  - Token generation rate (tokens/second)
- **Success/failure rates**: By model, provider, task type
- **Concurrency metrics**: Active tasks, queue depth, throughput
- **Resource usage**: Memory, file I/O, subprocess spawns

### Cost Tracking Requirements
- **Per-task costs**:
  - Input/output tokens by model
  - Estimated cost based on provider pricing
  - Cumulative costs per session
- **Model comparison**: Cost efficiency across models
- **Budget alerts**: Warnings when approaching limits
- **Historical tracking**: Daily/weekly/monthly aggregates

## 3. Architecture

### Logger Design

```typescript
// packages/karl/src/logger.ts

import { type Static } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// Log levels in order of severity
export enum LogLevel {
  TRACE = 0,
  DEBUG = 10,
  INFO = 20,
  WARN = 30,
  ERROR = 40,
  FATAL = 50
}

// Structured log entry schema
export const LogEntrySchema = Type.Object({
  timestamp: Type.String({ format: 'date-time' }),
  level: Type.Enum(LogLevel),
  message: Type.String(),
  context: Type.Object({
    correlationId: Type.Optional(Type.String()),
    taskId: Type.Optional(Type.String()),
    phase: Type.Optional(Type.String()), // 'cli', 'scheduler', 'runner', 'tool', 'hook'
    component: Type.String(), // File/module name
    model: Type.Optional(Type.String()),
    provider: Type.Optional(Type.String()),
    skill: Type.Optional(Type.String()),
  }),
  data: Type.Optional(Type.Any()), // Arbitrary structured data
  error: Type.Optional(Type.Object({
    message: Type.String(),
    stack: Type.Optional(Type.String()),
    code: Type.Optional(Type.String()),
  })),
  metrics: Type.Optional(Type.Object({
    duration: Type.Optional(Type.Number()), // milliseconds
    tokens: Type.Optional(Type.Object({
      input: Type.Number(),
      output: Type.Number(),
      total: Type.Number(),
    })),
    cost: Type.Optional(Type.Object({
      amount: Type.Number(),
      currency: Type.String(),
    })),
  })),
});

export type LogEntry = Static<typeof LogEntrySchema>;

export interface LoggerConfig {
  level: LogLevel;
  outputs: LogOutput[];
  format: 'json' | 'pretty';
  correlationId?: string;
  context?: Record<string, any>;
}

export interface LogOutput {
  type: 'console' | 'file' | 'callback';
  options?: {
    // For file output
    path?: string;
    maxSize?: number; // bytes
    maxFiles?: number;
    // For callback
    callback?: (entry: LogEntry) => void;
  };
}

export class Logger {
  private config: LoggerConfig;
  private contextStack: Array<Record<string, any>> = [];

  constructor(config: LoggerConfig) {
    this.config = config;
  }

  // Create child logger with additional context
  child(context: Record<string, any>): Logger {
    const childConfig = {
      ...this.config,
      context: { ...this.config.context, ...context }
    };
    return new Logger(childConfig);
  }

  // Context management for nested operations
  pushContext(context: Record<string, any>): void {
    this.contextStack.push(context);
  }

  popContext(): void {
    this.contextStack.pop();
  }

  // Core logging methods
  trace(message: string, data?: any): void {
    this.log(LogLevel.TRACE, message, data);
  }

  debug(message: string, data?: any): void {
    this.log(LogLevel.DEBUG, message, data);
  }

  info(message: string, data?: any): void {
    this.log(LogLevel.INFO, message, data);
  }

  warn(message: string, data?: any): void {
    this.log(LogLevel.WARN, message, data);
  }

  error(message: string, error?: Error | any, data?: any): void {
    const errorData = error instanceof Error ? {
      message: error.message,
      stack: error.stack,
      code: (error as any).code,
    } : error;

    this.log(LogLevel.ERROR, message, { ...data, error: errorData });
  }

  fatal(message: string, error?: Error | any, data?: any): void {
    const errorData = error instanceof Error ? {
      message: error.message,
      stack: error.stack,
      code: (error as any).code,
    } : error;

    this.log(LogLevel.FATAL, message, { ...data, error: errorData });
  }

  // Performance tracking
  startTimer(): () => number {
    const start = performance.now();
    return () => Math.round(performance.now() - start);
  }

  // Token/cost tracking
  logTokenUsage(taskId: string, usage: TokenUsage, model: string): void {
    const cost = this.estimateCost(usage, model);
    this.info('Token usage tracked', {
      metrics: {
        tokens: {
          input: usage.inputTokens,
          output: usage.outputTokens,
          total: usage.totalTokens,
        },
        cost: cost ? {
          amount: cost,
          currency: 'USD'
        } : undefined
      }
    });
  }

  private log(level: LogLevel, message: string, data?: any): void {
    if (level < this.config.level) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: {
        ...this.config.context,
        ...this.mergeContextStack(),
        component: this.getCallerComponent(),
      },
      data,
    };

    // Extract metrics if present in data
    if (data?.metrics) {
      entry.metrics = data.metrics;
      delete data.metrics;
    }

    this.config.outputs.forEach(output => {
      this.writeToOutput(output, entry);
    });
  }

  private writeToOutput(output: LogOutput, entry: LogEntry): void {
    switch (output.type) {
      case 'console':
        this.writeToConsole(entry);
        break;
      case 'file':
        this.writeToFile(entry, output.options);
        break;
      case 'callback':
        output.options?.callback?.(entry);
        break;
    }
  }

  private writeToConsole(entry: LogEntry): void {
    const formatted = this.config.format === 'json'
      ? JSON.stringify(entry)
      : this.formatPretty(entry);

    if (entry.level >= LogLevel.ERROR) {
      console.error(formatted);
    } else {
      console.log(formatted);
    }
  }

  private writeToFile(entry: LogEntry, options?: LogOutput['options']): void {
    const logDir = options?.path || join(homedir(), '.config', 'karl', 'logs');
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }

    const filename = `karl-${new Date().toISOString().split('T')[0]}.log`;
    const filepath = join(logDir, filename);

    const line = JSON.stringify(entry) + '\n';
    writeFileSync(filepath, line, { flag: 'a' });

    // TODO: Implement log rotation based on maxSize/maxFiles
  }

  private formatPretty(entry: LogEntry): string {
    const levelColors = {
      [LogLevel.TRACE]: '\x1b[90m', // gray
      [LogLevel.DEBUG]: '\x1b[36m', // cyan
      [LogLevel.INFO]: '\x1b[32m',  // green
      [LogLevel.WARN]: '\x1b[33m',  // yellow
      [LogLevel.ERROR]: '\x1b[31m', // red
      [LogLevel.FATAL]: '\x1b[35m', // magenta
    };

    const levelNames = {
      [LogLevel.TRACE]: 'TRACE',
      [LogLevel.DEBUG]: 'DEBUG',
      [LogLevel.INFO]: 'INFO ',
      [LogLevel.WARN]: 'WARN ',
      [LogLevel.ERROR]: 'ERROR',
      [LogLevel.FATAL]: 'FATAL',
    };

    const color = levelColors[entry.level];
    const reset = '\x1b[0m';
    const dim = '\x1b[90m';

    let output = `${dim}${entry.timestamp}${reset} ${color}${levelNames[entry.level]}${reset} `;

    if (entry.context.correlationId) {
      output += `${dim}[${entry.context.correlationId.substring(0, 8)}]${reset} `;
    }

    output += `${dim}${entry.context.component}${reset} ${entry.message}`;

    if (entry.data && Object.keys(entry.data).length > 0) {
      output += ` ${dim}${JSON.stringify(entry.data)}${reset}`;
    }

    if (entry.error) {
      output += `\n  ${color}${entry.error.message}${reset}`;
      if (entry.error.stack && this.config.level <= LogLevel.DEBUG) {
        output += `\n${dim}${entry.error.stack}${reset}`;
      }
    }

    return output;
  }

  private mergeContextStack(): Record<string, any> {
    return this.contextStack.reduce((acc, ctx) => ({ ...acc, ...ctx }), {});
  }

  private getCallerComponent(): string {
    // Extract component name from stack trace
    const stack = new Error().stack?.split('\n') || [];
    const callerLine = stack[4] || ''; // Skip Error, this method, log method, public method
    const match = callerLine.match(/at\s+(?:\S+\s+\()?(.*?):(\d+):(\d+)/);
    if (match) {
      const filepath = match[1];
      return filepath.split('/').pop()?.replace('.ts', '') || 'unknown';
    }
    return 'unknown';
  }

  private estimateCost(usage: TokenUsage, model: string): number | undefined {
    // Cost per 1M tokens (example rates)
    const pricing: Record<string, { input: number; output: number }> = {
      'claude-3-opus': { input: 15, output: 75 },
      'claude-3-sonnet': { input: 3, output: 15 },
      'claude-3-haiku': { input: 0.25, output: 1.25 },
      'gpt-4o': { input: 5, output: 15 },
      'gpt-4o-mini': { input: 0.15, output: 0.6 },
    };

    const modelPricing = pricing[model];
    if (!modelPricing) return undefined;

    const inputCost = (usage.inputTokens / 1_000_000) * modelPricing.input;
    const outputCost = (usage.outputTokens / 1_000_000) * modelPricing.output;

    return Math.round((inputCost + outputCost) * 1000) / 1000; // Round to 3 decimals
  }
}

// Global logger factory
let globalLogger: Logger | null = null;

export function createLogger(config: Partial<LoggerConfig> = {}): Logger {
  const defaultConfig: LoggerConfig = {
    level: process.env.LOG_LEVEL ?
      (LogLevel[process.env.LOG_LEVEL as keyof typeof LogLevel] || LogLevel.INFO) :
      LogLevel.INFO,
    outputs: [{ type: 'console' }],
    format: process.env.LOG_FORMAT === 'json' ? 'json' : 'pretty',
    ...config,
  };

  return new Logger(defaultConfig);
}

export function getLogger(): Logger {
  if (!globalLogger) {
    globalLogger = createLogger();
  }
  return globalLogger;
}

export function setGlobalLogger(logger: Logger): void {
  globalLogger = logger;
}
```

## 4. Integration Points

### CLI Integration
```typescript
// packages/karl/src/cli.ts
import { createLogger, setGlobalLogger, LogLevel } from './logger';

// Initialize logger based on CLI flags
const logLevel = options.verbose ? LogLevel.DEBUG :
                 options.quiet ? LogLevel.WARN :
                 LogLevel.INFO;

const logger = createLogger({
  level: logLevel,
  format: options.json ? 'json' : 'pretty',
  outputs: [
    { type: 'console' },
    ...(options.logFile ? [{
      type: 'file' as const,
      options: { path: options.logFile }
    }] : [])
  ],
  correlationId: crypto.randomUUID(),
});

setGlobalLogger(logger);
```

### Runner Integration
```typescript
// packages/karl/src/runner.ts - Enhanced with logging

import { getLogger } from './logger';

export async function runTask(params: RunTaskParams): Promise<TaskResult> {
  const logger = getLogger().child({
    taskId: params.taskId,
    phase: 'runner',
    model: params.modelId,
    provider: params.providerId,
  });

  const timer = logger.startTimer();
  logger.info('Task started', {
    skill: params.skill,
    timeout: params.timeout,
    hasTools: params.tools.length > 0,
  });

  try {
    logger.debug('Initializing agent loop', {
      toolCount: toolDefinitions.length,
      maxTokens: params.maxTokens,
    });

    // Run hooks with logging
    logger.pushContext({ phase: 'hook' });
    if (params.hooks) {
      logger.debug('Running pre-task hooks');
      await params.hooks.run('pre-task', {
        task: params.task,
        params,
        logger: logger.child({ hook: 'pre-task' })
      });
    }
    logger.popContext();

    // Tool calls with logging
    const result = await agentLoop({
      onToolCall: async (tool, args) => {
        const toolLogger = logger.child({
          phase: 'tool',
          tool: tool.name
        });
        const toolTimer = toolLogger.startTimer();

        toolLogger.debug('Tool execution started', { args });

        try {
          const result = await tool.execute(args);
          const duration = toolTimer();

          toolLogger.info('Tool execution completed', {
            metrics: { duration },
            resultSize: JSON.stringify(result).length,
          });

          return result;
        } catch (error) {
          toolLogger.error('Tool execution failed', error, { args });
          throw error;
        }
      },
    });

    // Extract and log token usage
    const tokenUsage = extractTokenUsage(result);
    if (tokenUsage) {
      logger.logTokenUsage(params.taskId || 'unknown', tokenUsage, params.modelId);
    }

    const duration = timer();
    logger.info('Task completed successfully', {
      metrics: {
        duration,
        tokens: tokenUsage,
      }
    });

    return { success: true, result, tokenUsage };

  } catch (error: any) {
    const duration = timer();
    logger.error('Task failed', error, {
      metrics: { duration },
    });

    return { success: false, error: error.message };
  }
}
```

### Scheduler Integration
```typescript
// packages/karl/src/scheduler.ts
export class VolleyScheduler extends EventEmitter {
  private logger = getLogger().child({ phase: 'scheduler' });

  async run(tasks: SchedulerTask[]): Promise<Map<string, SchedulerTask>> {
    const volleyLogger = this.logger.child({
      correlationId: crypto.randomUUID(),
      taskCount: tasks.length,
    });

    volleyLogger.info('Volley started', {
      maxConcurrent: this.maxConcurrent,
      retryConfig: this.retryConfig,
    });

    this.emit('scheduler:event', {
      type: 'VOLLEY_STARTED',
      timestamp: Date.now(),
      data: { taskCount: tasks.length },
      logger: volleyLogger,
    });

    // ... rest of implementation
  }
}
```

### Hook Integration
```typescript
// Enhanced hook interface
export interface HookEvent {
  task?: string;
  params?: any;
  result?: any;
  error?: any;
  logger?: Logger; // Hooks receive a scoped logger
}

// Example hook using logger
export async function preTaskHook(event: HookEvent) {
  const { logger, task } = event;
  logger?.info('Custom hook: validating task', {
    taskLength: task?.length
  });

  const startTime = Date.now();
  // ... do work ...
  const duration = Date.now() - startTime;

  logger?.debug('Custom hook: validation complete', {
    metrics: { duration }
  });
}
```

## 5. Output Formats

### JSON Format (Structured)
```json
{
  "timestamp": "2024-01-10T15:30:45.123Z",
  "level": 20,
  "message": "Task completed successfully",
  "context": {
    "correlationId": "a1b2c3d4",
    "taskId": "task-123",
    "phase": "runner",
    "component": "runner",
    "model": "claude-3-sonnet",
    "provider": "anthropic"
  },
  "metrics": {
    "duration": 3456,
    "tokens": {
      "input": 1250,
      "output": 850,
      "total": 2100
    },
    "cost": {
      "amount": 0.047,
      "currency": "USD"
    }
  }
}
```

### Pretty Format (Human-readable)
```
2024-01-10T15:30:45.123Z INFO  [a1b2c3d4] runner Task completed successfully {"model":"claude-3-sonnet","duration":3456,"tokens":2100,"cost":0.047}
```

### File Rotation Strategy
```
~/.config/karl/logs/
├── karl-2024-01-10.log    # Current day
├── karl-2024-01-09.log    # Previous days
├── karl-2024-01-08.log
└── archive/               # Compressed older logs
    └── karl-2024-01.tar.gz
```

## 6. Token/Cost Tracking

### Metrics Aggregator
```typescript
// packages/karl/src/metrics.ts
export class MetricsAggregator {
  private metricsPath: string;

  async trackUsage(entry: LogEntry): Promise<void> {
    if (!entry.metrics?.tokens) return;

    const metrics = await this.loadMetrics();
    const date = new Date(entry.timestamp).toISOString().split('T')[0];
    const model = entry.context.model || 'unknown';

    // Initialize structures
    metrics.daily[date] = metrics.daily[date] || {};
    metrics.daily[date][model] = metrics.daily[date][model] || {
      tasks: 0,
      tokens: { input: 0, output: 0, total: 0 },
      cost: 0,
    };

    // Aggregate
    const modelMetrics = metrics.daily[date][model];
    modelMetrics.tasks++;
    modelMetrics.tokens.input += entry.metrics.tokens.input;
    modelMetrics.tokens.output += entry.metrics.tokens.output;
    modelMetrics.tokens.total += entry.metrics.tokens.total;
    modelMetrics.cost += entry.metrics.cost?.amount || 0;

    await this.saveMetrics(metrics);
  }

  async getReport(period: 'daily' | 'weekly' | 'monthly'): Promise<MetricsReport> {
    const metrics = await this.loadMetrics();
    // ... generate report based on period
    return report;
  }
}
```

### CLI Command
```bash
karl metrics show                 # Today's usage
karl metrics show --period weekly # Last 7 days
karl metrics show --by-model      # Breakdown by model
karl metrics export --format csv  # Export for analysis
```

## 7. Implementation Plan

### Phase 1: Core Logger (Week 1)
**Goal**: Replace console.log with structured logger

Files to modify:
- Create: `packages/karl/src/logger.ts`
- Update: `packages/karl/src/cli.ts` - Initialize global logger
- Update: `packages/karl/src/runner.ts` - Add basic logging
- Update: `packages/karl/src/scheduler.ts` - Add volley logging
- Update: `packages/karl/src/print.ts` - Use logger for output

### Phase 2: Integration (Week 2)
**Goal**: Comprehensive logging coverage

Files to modify:
- Update: `packages/karl/src/tools.ts` - Log tool execution
- Update: `packages/karl/src/hooks.ts` - Pass logger to hooks
- Update: `packages/karl/src/config.ts` - Add logger config
- Update: `packages/karl/src/skills.ts` - Log skill loading
- Update: `packages/karl/src/stacks.ts` - Log stack resolution

### Phase 3: Metrics & Cost Tracking (Week 3)
**Goal**: Token usage aggregation and reporting

Files to create:
- Create: `packages/karl/src/metrics.ts` - Aggregation service
- Create: `packages/karl/src/commands/metrics.ts` - CLI command

Files to modify:
- Update: `packages/karl/src/types.ts` - Add metrics types
- Update: `packages/karl/src/cli.ts` - Add metrics command

### Phase 4: Observability Features (Week 4)
**Goal**: Advanced features and polish

Features:
- Log file rotation
- Performance profiling
- Remote logging adapter
- Budget alerts

### Migration Guide

```typescript
// Before
console.log(`Running task: ${task}`);
console.error('Error:', error.message);

// After
logger.info('Running task', { task });
logger.error('Task failed', error);

// With context
const taskLogger = logger.child({ taskId, model });
taskLogger.debug('Starting execution');

// With metrics
const timer = logger.startTimer();
// ... do work ...
logger.info('Operation complete', {
  metrics: { duration: timer() }
});
```

### Configuration

```json
// ~/.config/karl/karl.json
{
  "logging": {
    "level": "INFO",
    "format": "pretty",
    "file": {
      "enabled": true,
      "path": "~/.config/karl/logs",
      "maxSize": "10MB",
      "maxFiles": 7
    }
  },
  "budget": {
    "daily": 10.0,
    "monthly": 250.0,
    "alertThreshold": 0.8
  }
}
```

### Environment Variables
- `LOG_LEVEL`: TRACE, DEBUG, INFO, WARN, ERROR
- `LOG_FORMAT`: json, pretty
- `LOG_FILE`: Path to log file
- `KARL_METRICS_ENABLED`: Enable metrics tracking
- `KARL_BUDGET_DAILY`: Daily spend limit in USD
