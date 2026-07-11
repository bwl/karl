/**
 * Task Runner
 *
 * Runs a single task using the custom agent loop.
 */

import { agentLoop, type AgentLoopConfig, type ToolDefinition, type AgentEvent } from './agent-loop.js';
import { createBuiltinTools, loadCustomTools } from './tools.js';
import { HookRunner } from './hooks.js';
import type { SchedulerEvent, TaskResult, TokenUsage, ToolDiff, ToolsConfig } from './types.js';
import { formatError } from './utils.js';
import { TaskRunError, TimeoutError } from './errors.js';
import { CodexClient } from './magic-client.js';
import { isCodexProvider } from './codex-provider.js';

export interface RunTaskParams {
  task: string;
  index: number;
  attempt: number;
  cwd: string;
  model: string;
  providerKey: string;
  providerType?: string;
  apiKey: string;
  baseUrl?: string;
  systemPrompt: string;
  hooks: HookRunner;
  toolsConfig: ToolsConfig;
  noTools?: boolean;
  unrestricted?: boolean;
  timeoutMs?: number;
  maxTokens?: number;
  requestBody?: Record<string, unknown>;
  maxToolRounds?: number;
  contextLength?: number;
  thinking?: { enabled: boolean; budgetTokens?: number };  // Extended thinking
  cacheControl?: boolean;                                   // Prompt caching
  onEvent?: (event: SchedulerEvent) => void;
  onAgentEvent?: (event: AgentEvent) => void;
  onDiff?: (diff: ToolDiff) => void;
  diffConfig?: { maxBytes?: number; maxLines?: number };
}

function extractTokens(usage: any): TokenUsage | undefined {
  if (!usage || typeof usage !== 'object') {
    return undefined;
  }
  const input = usage.input ?? usage.inputTokens ?? usage.prompt_tokens;
  const output = usage.output ?? usage.outputTokens ?? usage.completion_tokens;
  const total = usage.total ?? usage.totalTokens;
  const costValue = typeof usage.cost === 'object' ? usage.cost?.total : usage.cost;
  if (input === undefined && output === undefined && total === undefined && costValue === undefined) {
    return undefined;
  }
  return { input, output, total, cost: costValue };
}

async function runWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs?: number,
  onTimeout?: () => void
): Promise<T> {
  if (!timeoutMs) {
    return await promise;
  }
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      onTimeout?.();
      reject(new TimeoutError(`Task timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Adapt Karl's tool format to the agent loop's ToolDefinition format.
 */
function adaptTools(karlTools: any[]): ToolDefinition[] {
  return karlTools.map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    execute: tool.execute
  }));
}

async function runCodexTurn(
  params: RunTaskParams,
  onEvent: (event: SchedulerEvent) => void,
  onClient: (client: CodexClient) => void
): Promise<{ text: string; usage?: TokenUsage }> {
  if (params.noTools) {
    throw new Error(
      'Codex provider cannot guarantee --no-tools with the current app-server protocol. ' +
      'Choose an HTTP provider for no-tools runs.'
    );
  }

  const client = new CodexClient({
    cwd: params.cwd,
    model: params.model,
    instructions: params.systemPrompt,
    approvalPolicy: 'never',
    sandbox: params.unrestricted ? 'danger-full-access' : 'workspace-write',
    ephemeral: true,
  });
  onClient(client);
  let text = '';
  let usage: TokenUsage | undefined;
  const fileChanges = new Map<string, string>();

  try {
    await client.start();
    await client.initialize();
    await client.startThread();

    for await (const event of client.startTurn(params.task)) {
      switch (event.type) {
        case 'agent_message_delta':
          text += event.text;
          onEvent({ type: 'thinking', taskIndex: params.index, text: event.text, time: Date.now() });
          break;
        case 'command_start':
          params.onAgentEvent?.({
            type: 'tool_execution_start', toolName: 'bash', toolCallId: event.itemId,
            args: { command: event.command, cwd: event.cwd },
          });
          onEvent({ type: 'tool_start', taskIndex: params.index, tool: 'bash', detail: event.command, time: Date.now() });
          break;
        case 'command_end':
          params.onAgentEvent?.({
            type: 'tool_execution_end', toolName: 'bash', toolCallId: event.itemId,
            result: { content: [{ type: 'text', text: `exit code: ${event.exitCode ?? 'unknown'}` }] },
            isError: event.exitCode !== 0,
          });
          onEvent({
            type: 'tool_end', taskIndex: params.index, tool: 'bash', time: Date.now(),
            success: event.exitCode === 0,
            ...(event.exitCode === 0 ? {} : { error: `command exited ${event.exitCode ?? 'without a status'}` }),
          });
          break;
        case 'file_change': {
          const tool = 'edit';
          if (event.status === 'started') {
            fileChanges.set(event.itemId, tool);
            params.onAgentEvent?.({
              type: 'tool_execution_start', toolName: tool, toolCallId: event.itemId,
              args: { path: event.filePath },
            });
            onEvent({ type: 'tool_start', taskIndex: params.index, tool, detail: event.filePath, time: Date.now() });
          } else {
            fileChanges.delete(event.itemId);
            params.onAgentEvent?.({
              type: 'tool_execution_end', toolName: tool, toolCallId: event.itemId,
              result: { content: [{ type: 'text', text: event.status }] },
              isError: event.status === 'failed',
            });
            onEvent({ type: 'tool_end', taskIndex: params.index, tool, time: Date.now(), success: event.status !== 'failed' });
          }
          break;
        }
        case 'token_usage':
          usage = { input: event.input, output: event.output, total: event.total };
          break;
        case 'error':
          if (!event.willRetry) throw new Error(event.message);
          break;
        case 'turn_completed':
          if (event.status !== 'completed') throw new Error(event.error ?? `Codex turn ${event.status}`);
          if (!text && event.lastMessage) text = event.lastMessage;
          break;
      }
    }

    return { text, usage };
  } finally {
    for (const tool of fileChanges.values()) {
      onEvent({ type: 'tool_end', taskIndex: params.index, tool, time: Date.now(), success: false, error: 'Codex turn ended during file change' });
    }
    await client.close();
  }
}

export async function runTask(params: RunTaskParams): Promise<TaskResult> {
  const toolsUsed = new Set<string>();
  const onEvent = (event: SchedulerEvent) => {
    if (event.type === 'tool_start' || event.type === 'tool_end') {
      toolsUsed.add(event.tool);
    }
    params.onEvent?.(event);
  };

  const startTime = Date.now();
  onEvent({ type: 'task_start', taskIndex: params.index, task: params.task, time: startTime });

  await params.hooks.run('pre-task', {
    task: params.task,
    index: params.index,
    attempt: params.attempt,
    model: params.model,
    provider: params.providerKey
  });

  try {
    if (isCodexProvider({ type: params.providerType ?? '' })) {
      let codexClient: CodexClient | undefined;
      const result = await runWithTimeout(
        runCodexTurn(params, onEvent, (client) => { codexClient = client; }),
        params.timeoutMs,
        () => {
          void codexClient?.interrupt();
          void codexClient?.close();
        }
      );
      const durationMs = Date.now() - startTime;
      const taskResult: TaskResult = {
        task: params.task,
        status: 'success',
        result: result.text,
        durationMs,
        toolsUsed: Array.from(toolsUsed),
        tokens: result.usage,
      };
      onEvent({
        type: 'task_complete', taskIndex: params.index, task: params.task,
        time: Date.now(), result: result.text, durationMs,
        toolsUsed: taskResult.toolsUsed, tokens: result.usage,
      });
      await params.hooks.run('post-task', {
        task: params.task, index: params.index, attempt: params.attempt,
        model: params.model, provider: params.providerKey, result: result.text,
      });
      return taskResult;
    }

    const ctx = {
      cwd: params.cwd,
      hooks: params.hooks,
      onEvent,
      task: params.task,
      taskIndex: params.index,
      unrestricted: params.unrestricted,
      onDiff: params.onDiff,
      diffConfig: params.diffConfig
    };

    let tools: ToolDefinition[] = [];
    if (!params.noTools) {
      const builtinTools = await createBuiltinTools(ctx);
      const enabled = new Set(params.toolsConfig.enabled ?? []);
      const filteredBuiltins =
        params.toolsConfig.enabled.length > 0 ? builtinTools.filter((tool) => enabled.has(tool.name)) : builtinTools;
      const customTools = await loadCustomTools(params.toolsConfig.custom ?? [], ctx);
      tools = adaptTools([...filteredBuiltins, ...customTools]);
    }

    // Determine provider type and base URL
    const providerType = params.providerType === 'anthropic' ? 'anthropic' : 'openai';
    let baseUrl = params.baseUrl;

    // Default baseUrl for Anthropic providers
    if (!baseUrl && providerType === 'anthropic') {
      baseUrl = 'https://api.anthropic.com';
    }

    // Validate we have a base URL
    if (!baseUrl) {
      throw new Error(`No baseUrl configured for provider: ${params.providerKey}`);
    }

    // Build agent loop config
    const config: AgentLoopConfig = {
      model: params.model,
      baseUrl,
      apiKey: params.apiKey,
      providerType,
      maxTokens: params.maxTokens,
      requestBody: params.requestBody,
      maxToolRounds: params.maxToolRounds ?? 50,
      signal: params.timeoutMs ? new AbortController().signal : undefined,
      // Anthropic-specific features
      thinking: params.thinking?.enabled
        ? { type: 'enabled', budgetTokens: params.thinking.budgetTokens }
        : undefined,
      cacheControl: params.cacheControl
    };

    const controller = params.timeoutMs ? new AbortController() : null;
    if (controller) {
      config.signal = controller.signal;
    }

    // Run agent loop
    const runPromise = (async () => {
      let finalText = '';
      let finalUsage: TokenUsage | undefined;

      const loop = agentLoop(params.systemPrompt, params.task, tools, config);

      while (true) {
        const { value: event, done } = await loop.next();

        if (done) {
          // Generator returned final result
          const result = event as { message: any; usage: TokenUsage };
          finalUsage = result.usage;
          break;
        }

        // Handle events
        const agentEvent = event as AgentEvent;
        params.onAgentEvent?.(agentEvent);

        switch (agentEvent.type) {
          case 'text_delta':
            // Emit text as it streams (for thinking display)
            onEvent({
              type: 'thinking',
              taskIndex: params.index,
              text: agentEvent.delta,
              time: Date.now()
            });
            break;

          case 'text_end':
            finalText = agentEvent.text;
            break;



          case 'message_end':
            // Extract final text from message if not already set
            if (!finalText && agentEvent.message.content) {
              finalText = agentEvent.message.content;
            }
            break;

          case 'turn_end':
            finalUsage = agentEvent.usage;
            break;

          case 'error':
            throw agentEvent.error;
        }
      }

      return { text: finalText, usage: finalUsage };
    })();

    const result = await runWithTimeout(
      runPromise,
      params.timeoutMs,
      () => controller?.abort()
    );

    const tokens = extractTokens(result.usage);
    const durationMs = Date.now() - startTime;

    const taskResult: TaskResult = {
      task: params.task,
      status: 'success',
      result: result.text,
      durationMs,
      toolsUsed: Array.from(toolsUsed),
      tokens
    };

    onEvent({
      type: 'task_complete',
      taskIndex: params.index,
      task: params.task,
      time: Date.now(),
      result: result.text,
      durationMs,
      toolsUsed: taskResult.toolsUsed,
      tokens
    });

    await params.hooks.run('post-task', {
      task: params.task,
      index: params.index,
      attempt: params.attempt,
      model: params.model,
      provider: params.providerKey,
      result: result.text
    });

    return taskResult;
  } catch (error) {
    const message = formatError(error);
    const durationMs = Date.now() - startTime;

    await params.hooks.run('on-error', {
      scope: 'task',
      error: message,
      task: params.task,
      index: params.index
    });

    await params.hooks.run('post-task', {
      task: params.task,
      index: params.index,
      attempt: params.attempt,
      model: params.model,
      provider: params.providerKey,
      error: message
    });

    throw new TaskRunError(message, {
      retryable: (error as { retryable?: boolean }).retryable,
      toolsUsed: Array.from(toolsUsed),
      durationMs
    });
  }
}
