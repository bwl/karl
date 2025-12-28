/**
 * Karl Serve Command
 *
 * Exposes Karl's LLM generation capabilities via JSON-RPC over stdio.
 * This enables other tools (like Loom) to use Karl as their LLM execution layer.
 *
 * Protocol: JSON-RPC 2.0 over stdin/stdout
 * - One JSON object per line (newline-delimited)
 * - Supports streaming mode (SSE-like events)
 */

import { createInterface } from 'readline';
import { loadConfig, resolveModel, isConfigValid } from '../config.js';
import { getProviderOAuthToken } from '../oauth.js';
import { agentLoop, type Message, type AgentLoopConfig } from '../agent-loop.js';

/**
 * JSON-RPC request format
 */
interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params?: {
    messages?: Array<{ role: string; content: string }>;
    system?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    thinking?: {
      enabled: boolean;
      budgetTokens?: number;
    };
    cacheControl?: boolean;
    stream?: boolean;
  };
  id: string | number | null;
}

/**
 * JSON-RPC response format
 */
interface JsonRpcResponse {
  jsonrpc: '2.0';
  result?: {
    content: string;
    model: string;
    usage?: {
      input: number;
      output: number;
    };
    thinking?: string;
  };
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
  id: string | number | null;
}

/**
 * Streaming event format (when stream=true)
 */
interface StreamEvent {
  type: 'text_delta' | 'thinking_delta' | 'message_end' | 'error';
  delta?: string;
  content?: string;
  thinking?: string;
  model?: string;
  usage?: {
    input: number;
    output: number;
  };
  error?: string;
}

function sendResponse(response: JsonRpcResponse): void {
  console.log(JSON.stringify(response));
}

function sendStreamEvent(requestId: string | number | null, event: StreamEvent): void {
  console.log(JSON.stringify({ id: requestId, ...event }));
}

function sendError(id: string | number | null, code: number, message: string, data?: unknown): void {
  sendResponse({
    jsonrpc: '2.0',
    error: { code, message, data },
    id
  });
}

/**
 * Handle a generate request
 */
async function handleGenerate(request: JsonRpcRequest): Promise<void> {
  const params = request.params ?? {};
  const cwd = process.cwd();

  try {
    // Load config
    const config = await loadConfig(cwd);
    if (!isConfigValid(config)) {
      sendError(request.id, -32000, 'Karl not configured. Run `karl init` first.');
      return;
    }

    // Resolve model
    const modelOverride = params.model;
    const resolved = resolveModel(config, { model: modelOverride });

    // Get API key
    let apiKey: string | null | undefined;
    if (resolved.providerConfig.authType === 'oauth') {
      apiKey = await getProviderOAuthToken(resolved.providerKey);
    } else {
      apiKey = resolved.providerConfig.apiKey;
    }

    if (!apiKey) {
      sendError(request.id, -32000, `No credentials for provider: ${resolved.providerKey}`);
      return;
    }

    // Build messages
    const messages: Message[] = [];
    if (params.system) {
      messages.push({ role: 'system', content: params.system });
    }
    for (const msg of params.messages ?? []) {
      messages.push({ role: msg.role as 'user' | 'assistant', content: msg.content });
    }

    // If no messages provided, error
    if (messages.length === 0 || !messages.some(m => m.role === 'user')) {
      sendError(request.id, -32602, 'At least one user message is required');
      return;
    }

    // Determine provider type
    const providerType = resolved.providerConfig.type === 'anthropic' ||
      resolved.model.includes('claude')
      ? 'anthropic'
      : 'openai';

    // Build agent loop config
    const agentConfig: AgentLoopConfig = {
      model: resolved.model,
      baseUrl: resolved.providerConfig.baseUrl || (
        providerType === 'anthropic'
          ? 'https://api.anthropic.com'
          : 'https://api.openai.com/v1'
      ),
      apiKey,
      providerType,
      maxTokens: params.maxTokens ?? resolved.maxTokens ?? 4096,
      temperature: params.temperature ?? 1.0,
      maxToolRounds: 0 // No tools for simple generation
    };

    // Add thinking config if specified
    if (params.thinking?.enabled) {
      agentConfig.thinking = {
        type: 'enabled',
        budgetTokens: params.thinking.budgetTokens ?? 4096
      };
    }

    // Add cache control if specified
    if (params.cacheControl) {
      agentConfig.cacheControl = true;
    }

    // Extract system and user message for agent loop
    const systemMsg = messages.find(m => m.role === 'system');
    const userMsgs = messages.filter(m => m.role === 'user' || m.role === 'assistant');
    const systemPrompt = systemMsg?.content ?? '';

    // For simple generation, combine all user messages
    const userMessage = userMsgs.map(m =>
      m.role === 'assistant' ? `Assistant: ${m.content}` : m.content
    ).join('\n\n');

    // Run generation
    let fullText = '';
    let fullThinking = '';
    let usage = { input: 0, output: 0 };
    const isStreaming = params.stream ?? false;

    for await (const event of agentLoop(systemPrompt, userMessage, [], agentConfig)) {
      if (event.type === 'text_delta') {
        fullText += event.delta;
        if (isStreaming) {
          sendStreamEvent(request.id, { type: 'text_delta', delta: event.delta });
        }
      } else if (event.type === 'thinking_delta') {
        fullThinking += event.delta;
        if (isStreaming) {
          sendStreamEvent(request.id, { type: 'thinking_delta', delta: event.delta });
        }
      } else if (event.type === 'turn_end') {
        if (event.usage) {
          usage.input = event.usage.input ?? 0;
          usage.output = event.usage.output ?? 0;
        }
      } else if (event.type === 'error') {
        sendError(request.id, -32000, event.error.message);
        return;
      }
    }

    // Send final response
    if (isStreaming) {
      sendStreamEvent(request.id, {
        type: 'message_end',
        content: fullText,
        thinking: fullThinking || undefined,
        model: resolved.model,
        usage
      });
    } else {
      sendResponse({
        jsonrpc: '2.0',
        result: {
          content: fullText,
          model: resolved.model,
          usage,
          thinking: fullThinking || undefined
        },
        id: request.id
      });
    }
  } catch (error) {
    sendError(request.id, -32000, (error as Error).message);
  }
}

/**
 * Handle incoming JSON-RPC requests
 */
async function handleRequest(line: string): Promise<void> {
  let request: JsonRpcRequest;
  try {
    request = JSON.parse(line);
  } catch {
    sendError(null, -32700, 'Parse error: Invalid JSON');
    return;
  }

  // Validate JSON-RPC format
  if (request.jsonrpc !== '2.0') {
    sendError(request.id, -32600, 'Invalid Request: Must be JSON-RPC 2.0');
    return;
  }

  if (!request.method) {
    sendError(request.id, -32600, 'Invalid Request: Method required');
    return;
  }

  // Dispatch based on method
  switch (request.method) {
    case 'generate':
      await handleGenerate(request);
      break;

    case 'ping':
      sendResponse({
        jsonrpc: '2.0',
        result: { pong: true },
        id: request.id
      });
      break;

    case 'info':
      const config = await loadConfig(process.cwd());
      const models = Object.keys(config.models || {});
      sendResponse({
        jsonrpc: '2.0',
        result: {
          version: '1.0.0',
          models,
          defaultModel: config.defaultModel
        },
        id: request.id
      });
      break;

    default:
      sendError(request.id, -32601, `Method not found: ${request.method}`);
  }
}

/**
 * Main serve loop - read JSON-RPC requests from stdin, respond on stdout
 */
export async function handleServeCommand(): Promise<void> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  // Disable stdout buffering for immediate responses
  process.stdout.write('');

  // Send ready signal
  console.error('karl serve: ready');

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    await handleRequest(trimmed);
  }
}
