export type ToolStatus = 'queued' | 'running' | 'done' | 'error';
export type TaskStatus = 'queued' | 'running' | 'done' | 'error';

export interface ToolTrace {
  name: string;
  status: ToolStatus;
  startedAt?: number;
  endedAt?: number;
  error?: string;
}

export interface TaskState {
  index: number;
  prompt: string;
  status: TaskStatus;
  tools: ToolTrace[];
  startedAt?: number;
  endedAt?: number;
  result?: string;
  error?: string;
  retries?: number;
}

export interface VolleyState {
  tasks: TaskState[];
  startTime: number;
}

export interface TokenUsage {
  input?: number;
  output?: number;
  total?: number;
  cost?: number;
}

export interface TaskResult {
  task: string;
  status: 'success' | 'error';
  result?: string;
  error?: string;
  durationMs: number;
  toolsUsed: string[];
  tokens?: TokenUsage;
}

export interface ModelConfig {
  provider: string;
  model: string;
  // Optional metadata (auto-fetched for OpenRouter)
  maxTokens?: number;
  contextLength?: number;
  description?: string;
  pricing?: {
    prompt: number;    // per million tokens
    completion: number;
  };
}

export interface ProviderConfig {
  type: string;
  baseUrl?: string;
  apiKey?: string;
  authType?: 'api_key' | 'oauth';
  [key: string]: unknown;
}

export interface ToolsConfig {
  enabled: string[];
  custom: string[];
}

export interface VolleyConfig {
  maxConcurrent: number;
  retryAttempts: number;
  retryBackoff: 'exponential' | 'linear';
}

export interface StackConfig {
  name?: string;              // Optional, inferred from filename/key
  extends?: string;           // Parent stack to inherit from
  model?: string;             // Model name or alias
  temperature?: number;       // 0-1
  timeout?: number;           // ms
  maxTokens?: number;         // Token limit
  skill?: string;             // Skill name to load
  context?: string;           // Inline context
  contextFile?: string;       // Path to context file
  unrestricted?: boolean;     // Bypass guardrails
}

export interface KarlConfig {
  defaultModel: string;
  models: Record<string, ModelConfig>;
  providers: Record<string, ProviderConfig>;
  tools: ToolsConfig;
  volley: VolleyConfig;
  stacks?: Record<string, StackConfig>;
}

export interface CliOptions {
  model?: string;
  verbose?: boolean;
  json?: boolean;
  stats?: boolean;
  maxConcurrent?: number;
  timeoutMs?: number;
  skill?: string;
  noTools?: boolean;
  unrestricted?: boolean;
  context?: string;
  contextFile?: string;
  tasksFile?: string;
  stack?: string;             // Config stack name (via "as" syntax)
  temperature?: number;       // Temperature override
  maxTokens?: number;         // Max tokens override
  dryRun?: boolean;           // Show config without running
  volley?: boolean;           // Enable multi-task mode
}

export interface SchedulerOptions {
  maxConcurrent: number;
  retryAttempts: number;
  retryBackoff: 'exponential' | 'linear';
  timeoutMs?: number;
}

export type SchedulerEvent =
  | { type: 'task_start'; taskIndex: number; task: string; time: number }
  | { type: 'thinking'; taskIndex: number; text: string; time: number }
  | { type: 'tool_start'; taskIndex: number; tool: string; detail?: string; time: number }
  | {
      type: 'tool_end';
      taskIndex: number;
      tool: string;
      time: number;
      success: boolean;
      error?: string;
    }
  | {
      type: 'task_complete';
      taskIndex: number;
      task: string;
      time: number;
      result: string;
      durationMs: number;
      toolsUsed: string[];
      tokens?: TokenUsage;
    }
  | {
      type: 'task_error';
      taskIndex: number;
      task: string;
      time: number;
      error: string;
      durationMs: number;
    }
  | {
      type: 'task_retry';
      taskIndex: number;
      task: string;
      time: number;
      attempt: number;
      delayMs: number;
      error: string;
    };

export type HookName = 'pre-task' | 'post-task' | 'pre-tool' | 'post-tool' | 'on-error';

export interface TaskHookEvent {
  task: string;
  index: number;
  attempt: number;
  model: string;
  provider: string;
}

export interface ToolHookEvent {
  tool: string;
  input: unknown;
  output?: unknown;
  success?: boolean;
  error?: string;
  task?: string;
  index?: number;
}

export interface ErrorHookEvent {
  scope: 'task' | 'tool';
  error: string;
  task?: string;
  index?: number;
  tool?: string;
}

export interface HookModule {
  'pre-task'?: (event: TaskHookEvent) => void | Promise<void>;
  'post-task'?: (event: TaskHookEvent & { result?: string; error?: string }) => void | Promise<void>;
  'pre-tool'?: (event: ToolHookEvent) => void | Promise<void>;
  'post-tool'?: (event: ToolHookEvent) => void | Promise<void>;
  'on-error'?: (event: ErrorHookEvent) => void | Promise<void>;
}
