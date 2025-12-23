# Karl Agent Loop Specification

## Overview

Replace `@mariozechner/pi-ai` with a custom agent loop implementation. The current dependency provides minimal value while adding complexity and brittleness.

## Current State Analysis

### What pi-ai provides (3 imports)
```typescript
import { agentLoop, getModel, setApiKey } from '@mariozechner/pi-ai';
```

1. **`setApiKey(provider, key)`** - Sets a global variable. Trivial.
2. **`getModel(provider, modelId)`** - Returns model config from hardcoded registry. Karl overrides most values anyway.
3. **`agentLoop(message, context, config, signal)`** - The only real value. Handles HTTP streaming and tool loop.

### What Karl already handles
- Provider configuration & API key management
- Model config construction (overrides pi-ai's getModel)
- Tool definitions, filtering, and execution logic
- Context/message building
- Event handling & streaming to UI
- Token extraction (handles multiple response formats)
- Timeout handling with AbortController
- Hooks system (pre-task, post-task, pre-tool, post-tool, on-error)
- Error handling & retry logic
- Result packaging

### Why replace pi-ai
1. **Brittleness**: Doesn't handle OpenAI-compatible APIs like antigravity correctly
2. **Complexity**: 200KB+ of code for what we need as ~500 lines
3. **Opacity**: Hard to debug when things go wrong
4. **Overhead**: Global state, model registry we don't use, provider-specific hacks we don't need

---

## Feature Specification

### Core Module: `packages/karl/src/agent-loop.ts`

#### Types

```typescript
// Message types (already defined in types.ts, may need extension)
interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentBlock[];
  tool_calls?: ToolCall[];
  tool_call_id?: string;  // For tool role messages
  name?: string;          // Tool name for tool role messages
}

interface ContentBlock {
  type: 'text' | 'image' | 'tool_use' | 'tool_result';
  text?: string;
  // ... other fields as needed
}

interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;  // JSON string
  };
}

interface ToolDefinition {
  name: string;
  description: string;
  parameters: object;  // JSON Schema
  execute: (params: any) => Promise<ToolResult>;
}

interface ToolResult {
  content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>;
  isError?: boolean;
}

// Agent loop config
interface AgentLoopConfig {
  model: string;
  baseUrl: string;
  apiKey: string;
  apiFormat: 'openai' | 'anthropic';
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

// Events emitted during agent loop
type AgentEvent =
  | { type: 'stream_start' }
  | { type: 'text_delta'; delta: string }
  | { type: 'text_end'; text: string }
  | { type: 'tool_call_start'; toolCall: ToolCall }
  | { type: 'tool_call_end'; toolCall: ToolCall }
  | { type: 'tool_execution_start'; toolName: string; args: any }
  | { type: 'tool_execution_end'; toolName: string; result: ToolResult; isError: boolean }
  | { type: 'message_end'; message: Message; usage?: TokenUsage }
  | { type: 'turn_end'; usage?: TokenUsage }
  | { type: 'error'; error: Error };

interface TokenUsage {
  input?: number;
  output?: number;
  total?: number;
  cost?: number;
}
```

#### Main Function

```typescript
/**
 * Run an agent loop until the model stops calling tools or an error occurs.
 *
 * @param systemPrompt - System prompt for the conversation
 * @param userMessage - Initial user message
 * @param tools - Available tools
 * @param config - API configuration
 * @yields AgentEvent - Events during execution
 * @returns Final assistant message
 */
export async function* agentLoop(
  systemPrompt: string,
  userMessage: string,
  tools: ToolDefinition[],
  config: AgentLoopConfig
): AsyncGenerator<AgentEvent, Message> {
  const messages: Message[] = [];

  // Add system message if provided
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }

  // Add user message
  messages.push({ role: 'user', content: userMessage });

  while (true) {
    // Make API request
    yield { type: 'stream_start' };

    const response = await streamCompletion(messages, tools, config);

    let fullText = '';
    let toolCalls: ToolCall[] = [];
    let usage: TokenUsage | undefined;

    // Process streaming response
    for await (const chunk of response) {
      if (chunk.type === 'text_delta') {
        fullText += chunk.delta;
        yield chunk;
      } else if (chunk.type === 'tool_call') {
        toolCalls.push(chunk.toolCall);
        yield { type: 'tool_call_start', toolCall: chunk.toolCall };
        yield { type: 'tool_call_end', toolCall: chunk.toolCall };
      } else if (chunk.type === 'usage') {
        usage = chunk.usage;
      }
    }

    if (fullText) {
      yield { type: 'text_end', text: fullText };
    }

    // Build assistant message
    const assistantMessage: Message = {
      role: 'assistant',
      content: fullText,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined
    };
    messages.push(assistantMessage);

    yield { type: 'message_end', message: assistantMessage, usage };

    // If no tool calls, we're done
    if (toolCalls.length === 0) {
      yield { type: 'turn_end', usage };
      return assistantMessage;
    }

    // Execute tool calls
    for (const toolCall of toolCalls) {
      const tool = tools.find(t => t.name === toolCall.function.name);

      if (!tool) {
        // Tool not found - add error result
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
          content: `Error: Tool "${toolCall.function.name}" not found`
        });
        continue;
      }

      let args: any;
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch {
        args = {};
      }

      yield { type: 'tool_execution_start', toolName: tool.name, args };

      let result: ToolResult;
      let isError = false;

      try {
        result = await tool.execute(args);
      } catch (error) {
        isError = true;
        result = {
          content: [{ type: 'text', text: `Error: ${error.message}` }],
          isError: true
        };
      }

      yield { type: 'tool_execution_end', toolName: tool.name, result, isError };

      // Add tool result to messages
      const resultText = result.content
        .filter(c => c.type === 'text')
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
```

#### Streaming Implementation

```typescript
/**
 * Stream a completion from the API.
 * Handles both OpenAI and Anthropic formats.
 */
async function* streamCompletion(
  messages: Message[],
  tools: ToolDefinition[],
  config: AgentLoopConfig
): AsyncGenerator<StreamChunk> {
  if (config.apiFormat === 'openai') {
    yield* streamOpenAI(messages, tools, config);
  } else {
    yield* streamAnthropic(messages, tools, config);
  }
}

type StreamChunk =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_call'; toolCall: ToolCall }
  | { type: 'usage'; usage: TokenUsage };

/**
 * OpenAI-compatible streaming (works with OpenRouter, Antigravity, etc.)
 */
async function* streamOpenAI(
  messages: Message[],
  tools: ToolDefinition[],
  config: AgentLoopConfig
): AsyncGenerator<StreamChunk> {
  const body: any = {
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
        parameters: t.parameters
      }
    }));
  }

  if (config.maxTokens) {
    body.max_tokens = config.maxTokens;
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
    const error = await response.text();
    throw new Error(`API error ${response.status}: ${error}`);
  }

  // Parse SSE stream
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  // Track tool calls being built
  const toolCallsInProgress: Map<number, { id: string; name: string; args: string }> = new Map();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') continue;

      try {
        const chunk = JSON.parse(data);
        const delta = chunk.choices?.[0]?.delta;

        if (delta?.content) {
          yield { type: 'text_delta', delta: delta.content };
        }

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

        // Check for finish_reason to emit completed tool calls
        if (chunk.choices?.[0]?.finish_reason === 'tool_calls') {
          for (const [_, tc] of toolCallsInProgress) {
            yield {
              type: 'tool_call',
              toolCall: {
                id: tc.id,
                type: 'function',
                function: { name: tc.name, arguments: tc.args }
              }
            };
          }
        }

        // Usage info
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
        // Ignore parse errors in stream
      }
    }
  }
}

/**
 * Anthropic-native streaming
 */
async function* streamAnthropic(
  messages: Message[],
  tools: ToolDefinition[],
  config: AgentLoopConfig
): AsyncGenerator<StreamChunk> {
  // Similar implementation for Anthropic's Messages API
  // Uses different message format and SSE event types
  // TODO: Implement when needed
  throw new Error('Anthropic streaming not yet implemented');
}

/**
 * Format messages for OpenAI API
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

    const formatted: any = {
      role: m.role,
      content: m.content
    };

    if (m.tool_calls) {
      formatted.tool_calls = m.tool_calls;
    }

    return formatted;
  });
}
```

---

## Integration with Karl

### Changes to `runner.ts`

```typescript
// Before
import { agentLoop, getModel, setApiKey } from '@mariozechner/pi-ai';

// After
import { agentLoop } from './agent-loop.js';
```

Remove:
- `mapToPiAiProvider()` - no longer needed
- `getModel()` call - we construct model config directly
- `setApiKey()` call - passed directly to agent loop

Simplify model config:
```typescript
const config: AgentLoopConfig = {
  model: params.model,
  baseUrl: params.baseUrl!,
  apiKey: params.apiKey,
  apiFormat: params.providerType === 'anthropic' ? 'anthropic' : 'openai',
  maxTokens: params.maxTokens,
  signal: controller?.signal
};
```

### Tool Interface Adapter

Current Karl tools return `AgentToolResult`. Need thin adapter:

```typescript
function adaptTool(tool: KarlTool): ToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,  // Already JSON Schema via TypeBox
    execute: async (params) => {
      const result = await tool.execute('', params);
      return {
        content: result.content,
        isError: false
      };
    }
  };
}
```

---

## Testing Plan

1. **Unit tests for SSE parsing**
   - Valid chunks with text deltas
   - Tool call streaming (partial arguments)
   - Usage reporting
   - Error handling

2. **Integration tests**
   - OpenAI API (gpt-4o)
   - OpenRouter (various models)
   - Antigravity (local server)
   - Anthropic (when implemented)

3. **Tool execution tests**
   - Single tool call
   - Multiple parallel tool calls
   - Tool errors
   - Tool not found

---

## Migration Path

1. Create `agent-loop.ts` with OpenAI streaming only
2. Update `runner.ts` to use new module
3. Test with OpenRouter (known working)
4. Test with Antigravity (currently broken)
5. Remove pi-ai dependency
6. Add Anthropic support if needed

---

## Estimated Effort

- Core agent loop: ~200 lines
- OpenAI streaming: ~150 lines
- Tool adapter: ~30 lines
- Runner integration: ~50 lines changed
- Tests: ~200 lines

**Total: ~600 lines** vs pi-ai's 200KB+ bundle

---

## Open Questions

1. **Anthropic support**: Do we need native Anthropic API, or is OpenAI-via-proxy sufficient?
   - Claude Pro/Max uses OAuth with Anthropic API
   - Could route through OpenRouter instead?

2. **Thinking/reasoning content**: Some models return `reasoning_content`. Handle or ignore?

3. **Image support**: Tools can return images. How to handle in tool results?

4. **Streaming text to UI**: Current implementation emits `thinking` events. Keep same pattern?
