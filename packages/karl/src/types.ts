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

export interface RetryConfig {
  attempts: number;
  backoff: 'exponential' | 'linear';
}

export interface HistoryConfig {
  enabled?: boolean;
  path?: string;
  maxDiffBytes?: number;
  maxDiffLines?: number;
  showId?: boolean;           // Show history ID after runs (default false)
}

export interface ThinkingConfig {
  enabled: boolean;           // Enable extended thinking
  budgetTokens?: number;      // Token budget for thinking (min 1024, default 4096)
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
  tools?: string[];           // Limit tools to these (e.g., ["read", "bash"])
  thinking?: ThinkingConfig;  // Extended thinking (Anthropic only)
  cacheControl?: boolean;     // Enable prompt caching (Anthropic only)
}

export interface AgentConfig {
  model?: string;             // Model name or alias for agent mode
  provider?: string;          // Provider override (optional)
}

export interface KarlConfig {
  defaultModel: string;
  models: Record<string, ModelConfig>;
  providers: Record<string, ProviderConfig>;
  tools: ToolsConfig;
  retry: RetryConfig;
  history?: HistoryConfig;
  stacks?: Record<string, StackConfig>;
  agent?: AgentConfig;
}

export interface CliOptions {
  model?: string;
  verbose?: boolean;
  json?: boolean;
  stats?: boolean;
  timeoutMs?: number;
  skill?: string;
  noTools?: boolean;
  unrestricted?: boolean;
  context?: string;
  contextFile?: string;
  stack?: string;             // Config stack name (via "as" syntax)
  temperature?: number;       // Temperature override
  maxTokens?: number;         // Max tokens override
  dryRun?: boolean;           // Show config without running
  parent?: string;
  tags?: string[];
  noHistory?: boolean;
  showHistoryId?: boolean;    // Show history ID after run
  background?: boolean;       // Run in background, return job ID
  plain?: boolean;
  visuals?: string;
  tools?: string[];           // Limit tools (from stack config)
  thinking?: ThinkingConfig;  // Extended thinking (Anthropic only)
  cacheControl?: boolean;     // Enable prompt caching (Anthropic only)
}

export interface ToolDiff {
  path: string;
  tool: 'write' | 'edit';
  ts: number;
  before?: string;
  after?: string;
  diff?: string;
  truncated?: boolean;
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
