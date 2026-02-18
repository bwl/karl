/**
 * Query Expansion — static synonyms + optional LLM expansion + cache
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { loadLlmConfig, chatComplete } from './llm.js';

const SYNONYM_MAP: Record<string, string[]> = {
  auth: ['login', 'logout', 'session', 'jwt', 'token', 'oauth', 'credentials', 'password'],
  login: ['auth', 'session', 'credentials', 'password', 'signin'],
  cache: ['redis', 'memcache', 'ttl', 'invalidate', 'store', 'memoize'],
  database: ['db', 'query', 'sql', 'migration', 'schema', 'model', 'orm'],
  db: ['database', 'query', 'sql', 'migration', 'schema', 'model'],
  api: ['endpoint', 'route', 'handler', 'controller', 'rest', 'middleware'],
  endpoint: ['api', 'route', 'handler', 'controller'],
  error: ['exception', 'throw', 'catch', 'failure', 'panic'],
  exception: ['error', 'throw', 'catch', 'failure'],
  test: ['spec', 'mock', 'stub', 'fixture', 'assert', 'expect'],
  spec: ['test', 'mock', 'fixture', 'assert', 'expect'],
  config: ['configuration', 'settings', 'options', 'env', 'dotenv'],
  socket: ['websocket', 'ws', 'realtime', 'connection', 'emit'],
  file: ['filesystem', 'read', 'write', 'path', 'stream', 'buffer'],
  state: ['store', 'reducer', 'dispatch', 'context', 'signal', 'reactive'],
  async: ['await', 'promise', 'callback', 'concurrent', 'parallel'],
  cli: ['command', 'args', 'argv', 'flag', 'option', 'parser'],
  build: ['compile', 'bundle', 'transpile', 'esbuild', 'rollup', 'webpack'],
  type: ['interface', 'typedef', 'schema', 'generic', 'enum'],
  log: ['logger', 'logging', 'debug', 'trace', 'console'],
  middleware: ['interceptor', 'handler', 'pipe', 'filter', 'guard'],
  route: ['router', 'path', 'endpoint', 'handler', 'navigate'],
  component: ['widget', 'element', 'render', 'jsx', 'template'],
  hook: ['lifecycle', 'callback', 'useeffect', 'usestate'],
  deploy: ['ci', 'cd', 'pipeline', 'release', 'publish'],
  parse: ['parser', 'tokenize', 'lexer', 'ast', 'syntax'],
  validate: ['validation', 'sanitize', 'check', 'constraint', 'schema'],
  permission: ['role', 'access', 'authorize', 'acl', 'rbac'],
};

export interface ExpandOptions {
  maxKeywords?: number;
  repoRoot?: string;
  useLlm?: boolean;
}

export function expandStatic(keywords: string[]): string[] {
  const expanded = new Set(keywords);
  for (const keyword of keywords) {
    const synonyms = SYNONYM_MAP[keyword.toLowerCase()];
    if (synonyms) {
      for (const syn of synonyms) {
        expanded.add(syn);
      }
    }
  }
  return Array.from(expanded);
}

export async function expandWithLlm(keywords: string[]): Promise<string[]> {
  const llm = await loadLlmConfig();
  if (!llm) return [];

  const prompt = `Given these code search keywords: ${JSON.stringify(keywords)}
Return a JSON array of 5-10 related programming terms/identifiers that would help find relevant source code files. Only return the JSON array, no explanation.`;

  try {
    const content = await chatComplete(llm, [
      { role: 'user', content: prompt },
    ], { temperature: 0.3, maxTokens: 200, timeoutMs: 5000 });

    return parseLlmSynonyms(content);
  } catch {
    return [];
  }
}

export function parseLlmSynonyms(content: string): string[] {
  if (!content) return [];

  const arrayMatch = content.match(/\[[\s\S]*?\]/);
  if (!arrayMatch) return [];

  try {
    const parsed = JSON.parse(arrayMatch[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === 'string')
      .map((s) => s.toLowerCase().trim())
      .filter((s) => s.length >= 2 && s.length <= 40);
  } catch {
    return [];
  }
}

interface SynonymCache {
  [key: string]: string[];
}

async function loadCache(repoRoot: string): Promise<SynonymCache> {
  const cachePath = join(repoRoot, '.ivo', 'cache', 'synonyms.json');
  try {
    const data = await readFile(cachePath, 'utf-8');
    return JSON.parse(data) as SynonymCache;
  } catch {
    return {};
  }
}

async function saveCache(repoRoot: string, cache: SynonymCache): Promise<void> {
  const cachePath = join(repoRoot, '.ivo', 'cache', 'synonyms.json');
  try {
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(cachePath, JSON.stringify(cache, null, 2));
  } catch {
    // Best effort
  }
}

function cacheKey(keywords: string[]): string {
  return keywords.slice().sort().join(',');
}

export async function expandKeywords(
  keywords: string[],
  options: ExpandOptions = {}
): Promise<string[]> {
  const maxKeywords = options.maxKeywords ?? 20;

  // Always apply static expansion
  const expanded = expandStatic(keywords);

  // Try LLM expansion if configured
  const llm = await loadLlmConfig();
  if (llm && options.useLlm !== false) {
    const repoRoot = options.repoRoot ?? process.cwd();
    const key = cacheKey(keywords);
    const cache = await loadCache(repoRoot);

    if (cache[key]) {
      for (const term of cache[key]) {
        expanded.push(term);
      }
    } else {
      const llmTerms = await expandWithLlm(keywords);
      if (llmTerms.length > 0) {
        cache[key] = llmTerms;
        await saveCache(repoRoot, cache);
        for (const term of llmTerms) {
          expanded.push(term);
        }
      }
    }
  }

  // Deduplicate and cap
  const unique = Array.from(new Set(expanded.map((t) => t.toLowerCase())));
  return unique.slice(0, maxKeywords);
}
