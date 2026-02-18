/**
 * Centralized LLM resolution + chat completion
 *
 * Resolves LLM config from env vars and ~/.config/ivo/config.json
 * from env vars and ~/.config/ivo/config.json.
 */

import { loadConfig, type IvoConfig } from './config.js';

export interface LlmConfig {
  endpoint: string;
  model: string;
  apiKey: string;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompleteOptions {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

const DEFAULT_MODEL = 'deepseek/deepseek-chat-v3-0324:free';
const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Resolve LLM config from env vars > ivo config.
 * Returns null if no endpoint is configured.
 */
export function resolveLlmConfig(config: IvoConfig): LlmConfig | null {
  const endpoint = process.env.IVO_LLM_ENDPOINT ?? config.llm?.endpoint;
  if (!endpoint) return null;

  const model = process.env.IVO_LLM_MODEL ?? config.llm?.model ?? DEFAULT_MODEL;
  const apiKey = process.env.IVO_LLM_API_KEY ?? config.llm?.apiKey ?? '';

  return { endpoint, model, apiKey };
}

/**
 * Load config and resolve LLM in one call.
 * Returns null if no LLM is configured.
 */
export async function loadLlmConfig(cwd?: string): Promise<LlmConfig | null> {
  const config = await loadConfig(cwd);
  return resolveLlmConfig(config);
}

/**
 * Single function for all LLM chat completions (expand, suggest, operator, label).
 * Uses the OpenAI-compatible /v1/chat/completions endpoint.
 */
export async function chatComplete(
  llm: LlmConfig,
  messages: ChatMessage[],
  options?: ChatCompleteOptions
): Promise<string> {
  const baseUrl = llm.endpoint.replace(/\/+$/, '');
  const url = `${baseUrl}/v1/chat/completions`;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (llm.apiKey) {
    headers['Authorization'] = `Bearer ${llm.apiKey}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: llm.model,
      messages,
      temperature: options?.temperature ?? 0.3,
      max_tokens: options?.maxTokens ?? 800,
    }),
    signal: AbortSignal.timeout(options?.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`LLM API error ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = (await response.json()) as ChatCompletionResponse;
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}
