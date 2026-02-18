/**
 * Embedding Provider — interface + OpenAI implementation
 */

import type { IvoConfig } from '../config.js';

export interface EmbeddingProvider {
  embedBatch(texts: string[]): Promise<number[][]>;
  readonly model: string;
  readonly dimensions: number;
}

interface EmbeddingResponseData {
  object: string;
  data: Array<{ object: string; index: number; embedding: number[] }>;
  model: string;
  usage: { prompt_tokens: number; total_tokens: number };
}

const DEFAULT_MODEL = 'text-embedding-3-small';
const DEFAULT_DIMENSIONS = 256;
const DEFAULT_ENDPOINT = 'https://api.openai.com';
const MAX_BATCH_SIZE = 2048;
const TIMEOUT_MS = 15000;

class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;
  private endpoint: string;
  private apiKey: string;

  constructor(endpoint: string, apiKey: string, model: string, dimensions: number) {
    this.endpoint = endpoint.replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.model = model;
    this.dimensions = dimensions;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const results: number[][] = [];

    // Chunk into batches of MAX_BATCH_SIZE
    for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
      const batch = texts.slice(i, i + MAX_BATCH_SIZE);
      const batchResults = await this.embedSingleBatch(batch);
      results.push(...batchResults);
    }

    return results;
  }

  private async embedSingleBatch(texts: string[]): Promise<number[][]> {
    const url = `${this.endpoint}/v1/embeddings`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: this.model,
        input: texts,
        dimensions: this.dimensions,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Embedding API error ${response.status}: ${body.slice(0, 200)}`);
    }

    const data = (await response.json()) as EmbeddingResponseData;

    // Sort by index to preserve input order
    const sorted = data.data.slice().sort((a, b) => a.index - b.index);
    return sorted.map((d) => d.embedding);
  }
}

/**
 * Create an embedding provider from config + env vars.
 * Returns null if no endpoint/key is available.
 */
export function createProvider(config: IvoConfig): EmbeddingProvider | null {
  const endpoint =
    process.env.IVO_EMBEDDING_ENDPOINT ??
    (config.embeddings?.provider && config.embeddings.provider !== 'openai'
      ? config.embeddings.provider
      : undefined) ??
    DEFAULT_ENDPOINT;

  const apiKey =
    process.env.IVO_EMBEDDING_API_KEY ??
    config.embeddings?.apiKey ??
    process.env.OPENAI_API_KEY ??
    '';

  if (!apiKey && endpoint === DEFAULT_ENDPOINT) {
    return null;
  }

  const model = config.embeddings?.model ?? DEFAULT_MODEL;
  const dimensions = config.embeddings?.dimensions ?? DEFAULT_DIMENSIONS;

  return new OpenAIEmbeddingProvider(endpoint, apiKey, model, dimensions);
}
