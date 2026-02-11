/**
 * Karl Agent Loop
 *
 * Custom implementation replacing @mariozechner/pi-ai.
 * Handles streaming completions and tool execution for OpenAI-compatible APIs.
 */

// ============================================================================
// Types
// ============================================================================

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: object;
  execute: (toolCallId: string, params: any, signal?: AbortSignal) => Promise<ToolResult>;
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; mediaType: string; data: string } }>;
  isError?: boolean;
}

export interface AgentLoopConfig {
  model: string;
  baseUrl: string;
  apiKey: string;
  providerType?: 'openai' | 'anthropic';  // API format to use
  maxTokens?: number;
  temperature?: number;
  maxToolRounds?: number;  // Safety limit for tool call loops
  signal?: AbortSignal;

  // Anthropic-specific options
  thinking?: {
    type: 'enabled' | 'disabled';
    budgetTokens?: number;  // Minimum 1024
  };
  cacheControl?: boolean;  // Enable prompt caching (90% cost savings)
}

export interface TokenUsage {
  input?: number;
  output?: number;
  total?: number;
  cost?: number;
}

export type AgentEvent =
  | { type: 'stream_start' }
  | { type: 'text_delta'; delta: string }
  | { type: 'text_end'; text: string }
  | { type: 'thinking_delta'; delta: string }    // Anthropic extended thinking
  | { type: 'thinking_end'; thinking: string }   // Anthropic extended thinking complete
  | { type: 'tool_call_start'; toolCall: ToolCall }
  | { type: 'tool_call_end'; toolCall: ToolCall }
  | { type: 'tool_execution_start'; toolName: string; toolCallId: string; args: any }
  | { type: 'tool_execution_end'; toolName: string; toolCallId: string; result: ToolResult; isError: boolean }
  | { type: 'message_end'; message: Message; usage?: TokenUsage }
  | { type: 'turn_end'; message: Message; usage?: TokenUsage }
  | { type: 'error'; error: Error };

// Internal type for stream chunks
type StreamChunk =
  | { type: 'text_delta'; delta: string }
  | { type: 'thinking_delta'; delta: string }    // Anthropic extended thinking
  | { type: 'tool_call'; toolCall: ToolCall }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'error'; error: string };

// ============================================================================
// Main Agent Loop
// ============================================================================

/**
 * Run an agent loop until the model stops calling tools or limits are reached.
 *
 * @param systemPrompt - System prompt for the conversation
 * @param userMessage - Initial user message
 * @param tools - Available tools
 * @param config - API configuration
 * @yields AgentEvent - Events during execution
 * @returns Final assistant message and accumulated usage
 */
// Track recent tool calls to detect repetitive loops
interface RecentToolCall {
  name: string;
  argsHash: string;
}

function hashArgs(args: any): string {
  try {
    return JSON.stringify(args);
  } catch {
    return String(args);
  }
}

const REPETITIVE_CALL_THRESHOLD = 3;

export async function* agentLoop(
  systemPrompt: string,
  userMessage: string,
  tools: ToolDefinition[],
  config: AgentLoopConfig
): AsyncGenerator<AgentEvent, { message: Message; usage: TokenUsage }> {
  const messages: Message[] = [];
  const maxToolRounds = config.maxToolRounds ?? 50;  // Default safety limit
  let toolRound = 0;
  let accumulatedUsage: TokenUsage = { input: 0, output: 0, total: 0, cost: 0 };

  // Track recent tool calls to detect repetitive patterns
  const recentToolCalls: RecentToolCall[] = [];

  // Add system message if provided
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }

  // Add user message
  messages.push({ role: 'user', content: userMessage });

  while (true) {
    // Check tool round limit
    if (toolRound >= maxToolRounds) {
      const errorMsg = `Stopped after ${maxToolRounds} tool rounds to prevent infinite loop`;
      yield { type: 'error', error: new Error(errorMsg) };
      throw new Error(errorMsg);
    }

    yield { type: 'stream_start' };

    let fullText = '';
    let fullThinking = '';
    let toolCalls: ToolCall[] = [];
    let turnUsage: TokenUsage = {};

    // Select stream function based on provider type
    const streamFn = config.providerType === 'anthropic'
      ? streamAnthropic
      : streamOpenAI;

    try {
      // Stream completion from API
      for await (const chunk of streamFn(messages, tools, config)) {
        if (chunk.type === 'text_delta') {
          fullText += chunk.delta;
          yield { type: 'text_delta', delta: chunk.delta };
        } else if (chunk.type === 'thinking_delta') {
          fullThinking += chunk.delta;
          yield { type: 'thinking_delta', delta: chunk.delta };
        } else if (chunk.type === 'tool_call') {
          toolCalls.push(chunk.toolCall);
          yield { type: 'tool_call_start', toolCall: chunk.toolCall };
          yield { type: 'tool_call_end', toolCall: chunk.toolCall };
        } else if (chunk.type === 'usage') {
          turnUsage = chunk.usage;
          // Accumulate usage
          accumulatedUsage.input = (accumulatedUsage.input ?? 0) + (chunk.usage.input ?? 0);
          accumulatedUsage.output = (accumulatedUsage.output ?? 0) + (chunk.usage.output ?? 0);
          accumulatedUsage.total = (accumulatedUsage.total ?? 0) + (chunk.usage.total ?? 0);
        } else if (chunk.type === 'error') {
          throw new Error(chunk.error);
        }
      }
    } catch (error) {
      yield { type: 'error', error: error as Error };
      throw error;
    }

    if (fullThinking) {
      yield { type: 'thinking_end', thinking: fullThinking };
    }

    if (fullText) {
      yield { type: 'text_end', text: fullText };
    }

    // Build assistant message
    // Note: When there are tool calls, content should be empty or null per OpenAI spec
    const assistantMessage: Message = {
      role: 'assistant',
      content: toolCalls.length > 0 ? '' : fullText,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined
    };
    messages.push(assistantMessage);

    yield { type: 'message_end', message: assistantMessage, usage: turnUsage };

    // If no tool calls, we're done
    if (toolCalls.length === 0) {
      yield { type: 'turn_end', message: assistantMessage, usage: accumulatedUsage };
      return { message: assistantMessage, usage: accumulatedUsage };
    }

    // Execute tool calls
    toolRound++;

    for (const toolCall of toolCalls) {
      const tool = tools.find(t => t.name === toolCall.function.name);

      if (!tool) {
        // Tool not found - add error result
        const errorContent = `Error: Tool "${toolCall.function.name}" not found`;
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
          content: errorContent
        });
        continue;
      }

      let args: any;
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch {
        args = {};
      }

      // Check for repetitive tool calls (same tool + same args N times in a row)
      const currentCall: RecentToolCall = { name: tool.name, argsHash: hashArgs(args) };
      recentToolCalls.push(currentCall);

      // Keep only the last N calls for comparison
      if (recentToolCalls.length > REPETITIVE_CALL_THRESHOLD) {
        recentToolCalls.shift();
      }

      // Check if last N calls are identical
      if (recentToolCalls.length >= REPETITIVE_CALL_THRESHOLD) {
        const lastCalls = recentToolCalls.slice(-REPETITIVE_CALL_THRESHOLD);
        const allIdentical = lastCalls.every(
          call => call.name === currentCall.name && call.argsHash === currentCall.argsHash
        );

        if (allIdentical) {
          const errorMsg = `Tried running ${tool.name} with the same arguments ${REPETITIVE_CALL_THRESHOLD} times in a row. There is probably something wrong.`;
          yield { type: 'error', error: new Error(errorMsg) };
          throw new Error(errorMsg);
        }
      }

      yield { type: 'tool_execution_start', toolName: tool.name, toolCallId: toolCall.id, args };

      let result: ToolResult;
      let isError = false;

      try {
        result = await tool.execute(toolCall.id, args, config.signal);
        isError = result.isError ?? false;
      } catch (error) {
        isError = true;
        result = {
          content: [{ type: 'text', text: `Error: ${(error as Error).message}` }],
          isError: true
        };
      }

      yield { type: 'tool_execution_end', toolName: tool.name, toolCallId: toolCall.id, result, isError };

      // Add tool result to messages
      const resultText = result.content
        .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
        .map(c => c.text)
        .join('\n');

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        name: tool.name,
        content: resultText
      });
    }

    // Continue loop - model will see tool results and respond
  }
}

// ============================================================================
// OpenAI Streaming Implementation
// ============================================================================

/**
 * Sanitize JSON Schema for APIs that don't support all features.
 * Removes patternProperties, additionalProperties, etc. that some APIs reject.
 */
function sanitizeSchema(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema;

  // Clone to avoid mutating original
  const clean: any = Array.isArray(schema) ? [] : {};

  for (const [key, value] of Object.entries(schema)) {
    // Skip unsupported schema properties
    if (['patternProperties', 'additionalProperties', '$schema', '$id'].includes(key)) {
      continue;
    }

    // Recursively clean nested objects
    if (value && typeof value === 'object') {
      clean[key] = sanitizeSchema(value);
    } else {
      clean[key] = value;
    }
  }

  return clean;
}

/**
 * Stream a completion from an OpenAI-compatible API.
 */
async function* streamOpenAI(
  messages: Message[],
  tools: ToolDefinition[],
  config: AgentLoopConfig
): AsyncGenerator<StreamChunk> {
  const body: Record<string, any> = {
    model: config.model,
    messages: formatMessagesForOpenAI(messages),
    stream: true,
    stream_options: { include_usage: true }
  };

  if (tools.length > 0) {
    body.tools = tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: sanitizeSchema(t.parameters)
      }
    }));
  }

  if (config.maxTokens) {
    body.max_tokens = config.maxTokens;
  }

  if (config.temperature !== undefined) {
    body.temperature = config.temperature;
  }

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
    body: JSON.stringify(body),
    signal: config.signal
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = `API error ${response.status}`;
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson.error?.message || errorJson.message || errorMessage;
    } catch {
      if (errorText) errorMessage += `: ${errorText.slice(0, 200)}`;
    }
    yield { type: 'error', error: errorMessage };
    return;
  }

  if (!response.body) {
    yield { type: 'error', error: 'No response body' };
    return;
  }

  // Parse SSE stream
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  // Track tool calls being built (indexed by position)
  const toolCallsInProgress: Map<number, { id: string; name: string; args: string }> = new Map();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;

        const data = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed.slice(5);
        if (data === '[DONE]') continue;

        try {
          const chunk = JSON.parse(data);
          const choice = chunk.choices?.[0];
          const delta = choice?.delta;

          // Text content
          if (delta?.content) {
            yield { type: 'text_delta', delta: delta.content };
          }

          // Tool calls (streamed incrementally)
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const index = tc.index ?? 0;

              if (tc.id) {
                // New tool call starting
                toolCallsInProgress.set(index, {
                  id: tc.id,
                  name: tc.function?.name || '',
                  args: tc.function?.arguments || ''
                });
              } else if (toolCallsInProgress.has(index)) {
                // Continuing existing tool call
                const existing = toolCallsInProgress.get(index)!;
                if (tc.function?.name) existing.name += tc.function.name;
                if (tc.function?.arguments) existing.args += tc.function.arguments;
              }
            }
          }

          // Emit completed tool calls when finish_reason indicates
          const finishReason = choice?.finish_reason;
          if (finishReason === 'tool_calls' || finishReason === 'stop') {
            // Emit any accumulated tool calls
            for (const [_, tc] of toolCallsInProgress) {
              if (tc.id && tc.name) {
                yield {
                  type: 'tool_call',
                  toolCall: {
                    id: tc.id,
                    type: 'function',
                    function: { name: tc.name, arguments: tc.args || '{}' }
                  }
                };
              }
            }
            toolCallsInProgress.clear();
          }

          // Usage info (usually in final chunk)
          if (chunk.usage) {
            yield {
              type: 'usage',
              usage: {
                input: chunk.usage.prompt_tokens,
                output: chunk.usage.completion_tokens,
                total: chunk.usage.total_tokens
              }
            };
          }
        } catch {
          // Ignore JSON parse errors in stream (partial data)
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Format messages for OpenAI API format.
 */
function formatMessagesForOpenAI(messages: Message[]): any[] {
  return messages.map(m => {
    if (m.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: m.tool_call_id,
        content: m.content
      };
    }

    const formatted: Record<string, any> = {
      role: m.role
    };

    // When there are tool calls, content should be null (not empty string)
    if (m.tool_calls && m.tool_calls.length > 0) {
      formatted.content = null;
      formatted.tool_calls = m.tool_calls.map(tc => ({
        id: tc.id,
        type: 'function',
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments
        }
      }));
    } else {
      formatted.content = m.content;
    }

    return formatted;
  });
}

// ============================================================================
// Anthropic Native API Implementation
// ============================================================================

/**
 * Extract system prompt from messages (Anthropic uses separate system parameter).
 */
function extractSystemPrompt(messages: Message[]): string | undefined {
  const systemMsg = messages.find(m => m.role === 'system');
  return systemMsg?.content;
}

/**
 * Format messages for Anthropic API format.
 * Anthropic uses content blocks and different tool result format.
 */
function formatMessagesForAnthropic(messages: Message[]): any[] {
  const result: any[] = [];

  for (const m of messages) {
    // Skip system messages (handled separately)
    if (m.role === 'system') continue;

    if (m.role === 'tool') {
      // Anthropic expects tool results as user messages with tool_result content blocks
      // Find or create the user message to append this result to
      const lastMsg = result[result.length - 1];
      const toolResultBlock = {
        type: 'tool_result',
        tool_use_id: m.tool_call_id,
        content: m.content
      };

      if (lastMsg?.role === 'user' && Array.isArray(lastMsg.content)) {
        // Append to existing user message with tool results
        lastMsg.content.push(toolResultBlock);
      } else {
        // Create new user message for tool results
        result.push({
          role: 'user',
          content: [toolResultBlock]
        });
      }
    } else if (m.role === 'assistant') {
      const content: any[] = [];

      // Add text content if present
      if (m.content) {
        content.push({ type: 'text', text: m.content });
      }

      // Add tool use blocks
      if (m.tool_calls) {
        for (const tc of m.tool_calls) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: JSON.parse(tc.function.arguments || '{}')
          });
        }
      }

      result.push({
        role: 'assistant',
        content: content.length > 0 ? content : [{ type: 'text', text: '' }]
      });
    } else if (m.role === 'user') {
      result.push({
        role: 'user',
        content: m.content
      });
    }
  }

  return result;
}

/**
 * Stream a completion from Anthropic's native API.
 */
async function* streamAnthropic(
  messages: Message[],
  tools: ToolDefinition[],
  config: AgentLoopConfig
): AsyncGenerator<StreamChunk> {
  const systemPrompt = extractSystemPrompt(messages);

  const body: Record<string, any> = {
    model: config.model,
    max_tokens: config.maxTokens ?? 4096,
    messages: formatMessagesForAnthropic(messages),
    stream: true
  };

  // Add system prompt (can be string or array of content blocks)
  if (systemPrompt) {
    if (config.cacheControl) {
      // Use content blocks with cache_control for prompt caching
      body.system = [{
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' }
      }];
    } else {
      body.system = systemPrompt;
    }
  }

  // Add tools with Anthropic format (input_schema instead of parameters)
  if (tools.length > 0) {
    body.tools = tools.map((t, index) => {
      const tool: Record<string, any> = {
        name: t.name,
        description: t.description,
        input_schema: sanitizeSchema(t.parameters)
      };
      // Only apply cache_control to the last tool (caches all tools up to this point)
      // Anthropic limits cache_control to 4 blocks max
      if (config.cacheControl && index === tools.length - 1) {
        tool.cache_control = { type: 'ephemeral' };
      }
      return tool;
    });
  }

  // Add extended thinking if configured
  if (config.thinking?.type === 'enabled') {
    body.thinking = {
      type: 'enabled',
      budget_tokens: config.thinking.budgetTokens ?? 4096
    };
  }

  if (config.temperature !== undefined) {
    body.temperature = config.temperature;
  }

  // Detect OAuth vs API key based on token format
  // OAuth tokens: sk-ant-oat01-... (OAuth access token)
  // API keys: sk-ant-api... (regular API key)
  const isOAuthToken = config.apiKey.startsWith('sk-ant-oat');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01'
  };

  if (isOAuthToken) {
    // OAuth authentication uses Bearer token with oauth beta header
    headers['Authorization'] = `Bearer ${config.apiKey}`;
    headers['anthropic-beta'] = 'oauth-2025-04-20';
  } else {
    // Standard API key authentication
    headers['x-api-key'] = config.apiKey;
  }

  // Add additional beta headers
  const betaFeatures: string[] = [];
  if (isOAuthToken) betaFeatures.push('oauth-2025-04-20');
  if (config.cacheControl) betaFeatures.push('prompt-caching-2024-07-31');
  if (betaFeatures.length > 0) {
    headers['anthropic-beta'] = betaFeatures.join(',');
  }

  const response = await fetch(`${config.baseUrl}/v1/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: config.signal
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = `Anthropic API error ${response.status}`;
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson.error?.message || errorJson.message || errorMessage;
    } catch {
      if (errorText) errorMessage += `: ${errorText.slice(0, 200)}`;
    }
    yield { type: 'error', error: errorMessage };
    return;
  }

  if (!response.body) {
    yield { type: 'error', error: 'No response body' };
    return;
  }

  // Parse Anthropic SSE stream
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  // Track content blocks by index for tool use accumulation
  const contentBlocks: Map<number, { type: string; id?: string; name?: string; input: string }> = new Map();
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();

        // Parse event type line
        if (trimmed.startsWith('event: ')) {
          continue;  // Event type is in the data line
        }

        if (!trimmed.startsWith('data: ')) continue;

        const data = trimmed.slice(6);
        if (!data) continue;

        try {
          const event = JSON.parse(data);

          switch (event.type) {
            case 'message_start':
              // Initial message with input token count
              if (event.message?.usage?.input_tokens) {
                inputTokens = event.message.usage.input_tokens;
              }
              break;

            case 'content_block_start':
              // New content block starting
              const block = event.content_block;
              if (block.type === 'tool_use') {
                contentBlocks.set(event.index, {
                  type: 'tool_use',
                  id: block.id,
                  name: block.name,
                  input: ''
                });
              } else if (block.type === 'thinking') {
                contentBlocks.set(event.index, {
                  type: 'thinking',
                  input: ''
                });
              } else if (block.type === 'text') {
                contentBlocks.set(event.index, {
                  type: 'text',
                  input: ''
                });
              }
              break;

            case 'content_block_delta':
              const delta = event.delta;
              if (delta.type === 'text_delta') {
                yield { type: 'text_delta', delta: delta.text };
              } else if (delta.type === 'thinking_delta') {
                yield { type: 'thinking_delta', delta: delta.thinking };
              } else if (delta.type === 'input_json_delta') {
                // Accumulate tool input JSON
                const existing = contentBlocks.get(event.index);
                if (existing) {
                  existing.input += delta.partial_json;
                }
              }
              break;

            case 'content_block_stop':
              // Block complete - emit tool calls if applicable
              const completedBlock = contentBlocks.get(event.index);
              if (completedBlock?.type === 'tool_use' && completedBlock.id && completedBlock.name) {
                yield {
                  type: 'tool_call',
                  toolCall: {
                    id: completedBlock.id,
                    type: 'function',
                    function: {
                      name: completedBlock.name,
                      arguments: completedBlock.input || '{}'
                    }
                  }
                };
              }
              break;

            case 'message_delta':
              // Final delta with output tokens and stop reason
              if (event.usage?.output_tokens) {
                outputTokens = event.usage.output_tokens;
              }
              break;

            case 'message_stop':
              // Stream complete - emit usage
              yield {
                type: 'usage',
                usage: {
                  input: inputTokens,
                  output: outputTokens,
                  total: inputTokens + outputTokens
                }
              };
              break;

            case 'error':
              yield { type: 'error', error: event.error?.message || 'Unknown Anthropic error' };
              break;
          }
        } catch {
          // Ignore JSON parse errors in stream
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
