/**
 * Embedding Index — persistent vector index for semantic search
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { createHash } from 'crypto';
import { join, dirname } from 'path';
import type { IvoBackend } from '../backends/types.js';
import type { EmbeddingProvider } from './provider.js';
import { formatCodemapCompact } from '../codemap/index.js';

export interface EmbeddingEntry {
  path: string;
  hash: string;         // first 8 chars of sha256(content) for invalidation
  embedding: number[];  // float32 vector
}

export interface EmbeddingIndexFile {
  version: 1;
  model: string;
  dimensions: number;
  entries: EmbeddingEntry[];
}

function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 8);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function computeCentroid(vectors: number[][]): number[] | null {
  if (vectors.length === 0) return null;
  const dims = vectors[0].length;
  const sum = new Array<number>(dims).fill(0);
  for (const vec of vectors) {
    for (let i = 0; i < dims; i++) {
      sum[i] += vec[i];
    }
  }
  const n = vectors.length;
  return sum.map((v) => v / n);
}

function indexPath(repoRoot: string): string {
  return join(repoRoot, '.ivo', 'embeddings', 'index.json');
}

export class EmbeddingIndex {
  private entryMap: Map<string, EmbeddingEntry>;
  readonly model: string;
  readonly dimensions: number;

  private constructor(model: string, dimensions: number, entries: EmbeddingEntry[]) {
    this.model = model;
    this.dimensions = dimensions;
    this.entryMap = new Map();
    for (const entry of entries) {
      this.entryMap.set(entry.path, entry);
    }
  }

  get size(): number {
    return this.entryMap.size;
  }

  get entries(): EmbeddingEntry[] {
    return Array.from(this.entryMap.values());
  }

  get(path: string): EmbeddingEntry | undefined {
    return this.entryMap.get(path);
  }

  nearest(query: number[], k: number, exclude?: Set<string>): Array<{ path: string; similarity: number }> {
    const results: Array<{ path: string; similarity: number }> = [];

    for (const [path, entry] of this.entryMap) {
      if (exclude?.has(path)) continue;
      const similarity = cosineSimilarity(query, entry.embedding);
      results.push({ path, similarity });
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, k);
  }

  centroid(paths: string[]): number[] | null {
    const vectors: number[][] = [];
    for (const path of paths) {
      const entry = this.entryMap.get(path);
      if (entry) vectors.push(entry.embedding);
    }
    return computeCentroid(vectors);
  }

  static async load(repoRoot: string): Promise<EmbeddingIndex | null> {
    try {
      const data = await readFile(indexPath(repoRoot), 'utf-8');
      const file = JSON.parse(data) as EmbeddingIndexFile;
      if (file.version !== 1) return null;
      return new EmbeddingIndex(file.model, file.dimensions, file.entries);
    } catch {
      return null;
    }
  }

  static async build(
    repoRoot: string,
    provider: EmbeddingProvider,
    backend: IvoBackend,
    options?: { force?: boolean; dryRun?: boolean; onProgress?: (msg: string) => void }
  ): Promise<{ index: EmbeddingIndex; stats: BuildStats }> {
    const log = options?.onProgress ?? (() => {});

    // Load existing index if available
    const existing = options?.force ? null : await EmbeddingIndex.load(repoRoot);
    const existingMap = new Map<string, EmbeddingEntry>();
    if (existing && existing.model === provider.model && existing.dimensions === provider.dimensions) {
      for (const entry of existing.entries) {
        existingMap.set(entry.path, entry);
      }
    }

    // Get all code files via backend structure
    log('Scanning files...');
    const structure = await backend.getStructure([], { scope: 'selected' });
    const codemaps = structure.codemaps;

    // Build text-to-embed for each file, check against existing hashes
    const toEmbed: Array<{ path: string; text: string; hash: string }> = [];
    const kept: EmbeddingEntry[] = [];
    const currentPaths = new Set<string>();

    for (const codemap of codemaps) {
      const compact = formatCodemapCompact(codemap);
      if (!compact || compact.trim().length < 10) continue;

      currentPaths.add(codemap.path);
      const hash = contentHash(compact);
      const existingEntry = existingMap.get(codemap.path);

      if (existingEntry && existingEntry.hash === hash) {
        // Unchanged — keep existing embedding
        kept.push(existingEntry);
      } else {
        toEmbed.push({ path: codemap.path, text: compact, hash });
      }
    }

    // Count removed files
    const removedCount = existingMap.size > 0
      ? Array.from(existingMap.keys()).filter((p) => !currentPaths.has(p)).length
      : 0;

    const stats: BuildStats = {
      total: currentPaths.size,
      new: toEmbed.filter((e) => !existingMap.has(e.path)).length,
      updated: toEmbed.filter((e) => existingMap.has(e.path)).length,
      removed: removedCount,
      kept: kept.length,
    };

    if (options?.dryRun) {
      // Return empty index for dry run but with real stats
      return {
        index: new EmbeddingIndex(provider.model, provider.dimensions, kept),
        stats,
      };
    }

    // Embed changed files
    let newEntries: EmbeddingEntry[] = [];
    if (toEmbed.length > 0) {
      log(`Embedding ${toEmbed.length} files...`);
      const texts = toEmbed.map((e) => e.text);
      const embeddings = await provider.embedBatch(texts);

      newEntries = toEmbed.map((item, i) => ({
        path: item.path,
        hash: item.hash,
        embedding: embeddings[i],
      }));
    }

    const allEntries = [...kept, ...newEntries];
    const index = new EmbeddingIndex(provider.model, provider.dimensions, allEntries);

    // Save
    await index.save(repoRoot);
    log(`Saved index with ${allEntries.length} entries.`);

    return { index, stats };
  }

  async save(repoRoot: string): Promise<void> {
    const path = indexPath(repoRoot);
    await mkdir(dirname(path), { recursive: true });
    const file: EmbeddingIndexFile = {
      version: 1,
      model: this.model,
      dimensions: this.dimensions,
      entries: this.entries,
    };
    await writeFile(path, JSON.stringify(file));
  }
}

export interface BuildStats {
  total: number;
  new: number;
  updated: number;
  removed: number;
  kept: number;
}
