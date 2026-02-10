/**
 * Slicer Engine - shared planning + assembly for bucket filling
 */

import { spawn } from 'child_process';
import { readFile, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { basename, join, relative } from 'path';
import type { IvoBackend } from '../backends/types.js';
import type { ContextFile, ContextResult, SearchMatch } from '../types.js';
import { detectLanguage, extractCodemap, formatCodemapCompact } from '../codemap/index.js';
import { expandKeywords } from '../expand.js';
import { buildImportGraph, bfsWalk } from '../graph/index.js';
import type {
  SliceAlternate,
  SliceCandidate,
  SliceIntensity,
  SlicePlan,
  SliceRequest,
  SliceResult,
  SliceStrategy,
  SliceTree,
} from './types.js';

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const DEFAULT_BUDGET = 32000;
const DEFAULT_WARNING = 0.75;

const DEFAULT_STRATEGIES: Record<SliceIntensity, SliceStrategy[]> = {
  lite: ['inventory', 'skeleton', 'keyword', 'config'],
  standard: ['inventory', 'skeleton', 'keyword', 'symbols', 'config', 'diff', 'graph', 'forest'],
  deep: ['inventory', 'skeleton', 'keyword', 'symbols', 'config', 'diff', 'graph', 'ast', 'complexity', 'docs', 'forest'],
};

const DEFAULT_INTENSITY: SliceIntensity = 'deep';

// Strategy budget caps (percentage of total budget)
const STRATEGY_BUDGET_CAPS: Partial<Record<SliceStrategy, number>> = {
  keyword: 0.20,  // Max 20% of budget for keyword matches
  diff: 0.10,     // Max 10% for recent changes
  graph: 0.15,    // Max 15% for import graph
  docs: 0.10,     // Max 10% for docs
  forest: 0.25,   // Max 25% for forest knowledge graph
};

const STRATEGY_WEIGHTS: Record<SliceStrategy, number> = {
  explicit: 0.95,
  skeleton: 0.90,  // High priority - structural overview
  keyword: 0.65,   // Reduced - often matches docs more than code
  symbols: 0.55,
  graph: 0.50,     // Between symbols and config
  config: 0.45,
  diff: 0.6,
  inventory: 0.2,
  ast: 0.5,
  complexity: 0.4,
  docs: 0.30,      // Reduced - should be lower priority than code
  forest: 0.70,    // Knowledge graph - high value between keyword and skeleton
};

const REPRESENTATION_RANK: Record<SliceCandidate['representation'], number> = {
  full: 3,
  snippet: 2,
  codemap: 1,
  reference: 0,
};

const STOPWORDS = new Set([
  'the',
  'and',
  'or',
  'to',
  'for',
  'a',
  'an',
  'of',
  'in',
  'on',
  'is',
  'are',
  'this',
  'that',
  'with',
  'by',
  'add',
  'fix',
  'update',
  'change',
  'refactor',
  'improve',
  'make',
  'build',
  'review',
]);

export const CANDIDATE_SORT = [
  'score_desc',
  'strategy_order',
  'representation_desc',
  'tokens_asc',
  'path_asc',
] as const;

const CONFIG_FILES = [
  'package.json',
  'tsconfig.json',
  'tsconfig.base.json',
  'bunfig.toml',
  'bun.lock',
  'bun.lockb',
  'vite.config.ts',
  'vitest.config.ts',
  'jest.config.js',
  'tsup.config.ts',
  'rollup.config.js',
  '.env.example',
  'pyproject.toml',
  'setup.py',
  'setup.cfg',
  'requirements.txt',
  'go.mod',
  'go.sum',
  'Cargo.toml',
  'Makefile',
];

const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.rs', '.py', '.go'];

// Skeleton strategy: entry points and structural files
const SKELETON_PATTERNS = [
  // Entry points
  'cli.ts', 'cli.js', 'main.ts', 'main.js', 'mod.ts', 'mod.rs',
  'index.ts', 'index.js', 'lib.rs',
  'main.go', '__init__.py', '__main__.py',
  // Type definitions
  'types.ts', 'types.js', 'interfaces.ts',
  // Core modules (commonly named)
  'app.ts', 'app.js', 'server.ts', 'server.js',
  'app.py', 'setup.py',
];

// Directories to prioritize for skeleton (src/, lib/, packages/*/src/)
const SKELETON_DIRS = ['src/', 'lib/', 'packages/'];

const CORE_DOC_FILES = [
  'AGENTS.md',
  'AGENT_SKILLS_IMPLEMENTATION.md',
  'agentskills.md',
  'README.md',
  'README',
  'CLAUDE.md',
  'stack.md',
];

const DOC_PATH_HINTS = [
  'ideas/',
  'status/',
  'megamerge_docs/',
  'docs/',
  'README',
  'readme',
  'AGENTS.md',
  'CLAUDE.md',
  '.md',
];

const UNBOUNDED = Number.POSITIVE_INFINITY;

async function exec(cmd: string, args: string[], cwd?: string): Promise<ExecResult> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], cwd });
    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (d) => (stdout += d.toString()));
    proc.stderr?.on('data', (d) => (stderr += d.toString()));

    proc.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    proc.on('error', (error) => {
      resolve({ stdout: '', stderr: error.message, exitCode: 1 });
    });
  });
}

function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4);
}

function isDocPath(path: string): boolean {
  return DOC_PATH_HINTS.some((hint) => path.includes(hint));
}

function isCodePath(path: string): boolean {
  const lower = path.toLowerCase();
  return CODE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

async function listRepoFiles(repoRoot: string): Promise<string[]> {
  const result = await exec('rg', ['--files'], repoRoot);
  let files: string[] = [];

  if (result.exitCode === 0) {
    files = result.stdout.trim().split('\n').filter(Boolean);
  } else {
    const fallback = await exec('find', [repoRoot, '-type', 'f'], repoRoot);
    files = fallback.stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((file) => relative(repoRoot, file));
  }

  return files;
}

async function collectKeywordMatches(
  backend: IvoBackend,
  keywords: string[],
  request: SliceRequest,
  searchOptions: { contextLines: number; maxResults: number },
  predicate?: (path: string) => boolean
): Promise<Map<string, SearchMatch[]>> {
  const matchByFile = new Map<string, SearchMatch[]>();

  for (const keyword of keywords) {
    const result = await backend.search(keyword, {
      mode: 'content',
      contextLines: searchOptions.contextLines,
      maxResults: searchOptions.maxResults,
    });
    for (const match of result.matches) {
      if (!isPathIncluded(match.path, request)) continue;
      if (predicate && !predicate(match.path)) continue;
      const list = matchByFile.get(match.path) ?? [];
      list.push(match);
      matchByFile.set(match.path, list);
    }
  }

  return matchByFile;
}

function applyStrategyCaps(candidates: SliceCandidate[], request: SliceRequest): SliceCandidate[] {
  if (!request.strategyCaps) return candidates;

  const byStrategy = new Map<SliceStrategy, SliceCandidate[]>();
  for (const candidate of candidates) {
    const list = byStrategy.get(candidate.strategy) ?? [];
    list.push(candidate);
    byStrategy.set(candidate.strategy, list);
  }

  const capped: SliceCandidate[] = [];
  for (const [strategy, list] of byStrategy) {
    const caps = request.strategyCaps?.[strategy];
    if (!caps) {
      capped.push(...list);
      continue;
    }

    const maxItems = caps.maxItems ?? UNBOUNDED;
    let remainingTokens = caps.maxTokens ?? UNBOUNDED;
    const sorted = list
      .slice()
      .sort((a, b) => b.score - a.score || a.tokens - b.tokens || a.path.localeCompare(b.path));

    let count = 0;
    for (const candidate of sorted) {
      if (count >= maxItems) break;
      if (candidate.tokens > remainingTokens) continue;
      capped.push(candidate);
      remainingTokens -= candidate.tokens;
      count += 1;
    }
  }

  return capped;
}

export function rankCandidates(plan: SlicePlan): SliceCandidate[] {
  const order = new Map<string, number>();
  plan.request.strategies?.forEach((strategy, index) => {
    order.set(strategy, index);
  });
  order.set('explicit', -1);

  const strategyIndex = (strategy: SliceStrategy): number => {
    const value = order.get(strategy);
    return value === undefined ? 999 : value;
  };

  return plan.candidates
    .slice()
    .sort(
      (a, b) =>
        b.score - a.score ||
        strategyIndex(a.strategy) - strategyIndex(b.strategy) ||
        REPRESENTATION_RANK[b.representation] - REPRESENTATION_RANK[a.representation] ||
        a.tokens - b.tokens ||
        a.path.localeCompare(b.path)
    );
}

function normalizeIntensity(intensity?: SliceIntensity): SliceIntensity {
  if (intensity === 'lite' || intensity === 'standard' || intensity === 'deep') return intensity;
  return DEFAULT_INTENSITY;
}

function resolveIntensity(
  strategy: SliceStrategy,
  request: SliceRequest,
  fallback: SliceIntensity
): SliceIntensity {
  const override = request.strategyIntensity?.[strategy];
  return normalizeIntensity(override ?? fallback);
}

function extractKeywords(task: string, max: number): string[] {
  const words = task
    .toLowerCase()
    .match(/[a-z0-9_\-./]+/g)
    ?.filter((word) => word.length >= 3 && !STOPWORDS.has(word)) ?? [];

  const unique = Array.from(new Set(words));
  return unique.slice(0, max);
}

async function extractExplicitPaths(task: string, repoRoot: string): Promise<string[]> {
  const tokens = task.match(/[A-Za-z0-9_./\-]+/g) ?? [];
  const candidates = tokens.filter((token) => token.includes('/') || token.includes('.'));
  const found: string[] = [];

  for (const token of candidates) {
    const fullPath = join(repoRoot, token);
    try {
      const stats = await stat(fullPath);
      if (stats.isFile()) {
        found.push(token);
      }
    } catch {
      // Ignore missing paths
    }
  }

  return Array.from(new Set(found));
}

function scoreCandidate(
  strategy: SliceStrategy,
  matchCount: number,
  tokens: number,
  budget: number
): number {
  const base = STRATEGY_WEIGHTS[strategy] ?? 0.3;
  const matchBoost = Math.min(0.25, matchCount * 0.03);
  const sizePenalty = Math.min(0.2, tokens / (budget * 2));
  return Math.max(0.05, base + matchBoost - sizePenalty);
}

function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  const sorted = ranges.slice().sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];

  for (const range of sorted) {
    if (merged.length === 0) {
      merged.push(range);
      continue;
    }
    const last = merged[merged.length - 1];
    if (range[0] <= last[1] + 1) {
      last[1] = Math.max(last[1], range[1]);
    } else {
      merged.push(range);
    }
  }

  return merged;
}

function buildSnippet(path: string, lines: string[], lineNumbers: number[], context: number): string {
  const ranges = mergeRanges(
    lineNumbers.map((line) => [Math.max(1, line - context), Math.min(lines.length, line + context)])
  );
  const parts: string[] = [];

  for (const [start, end] of ranges) {
    parts.push(`${path}:${start}-${end}`);
    for (let i = start; i <= end; i++) {
      const lineContent = lines[i - 1] ?? '';
      parts.push(`${i} | ${lineContent}`);
    }
    parts.push('');
  }

  return parts.join('\n').trim();
}

function makeReferenceAlternate(path: string, reason: string): SliceAlternate {
  const content = `${path} (${reason})`;
  return {
    representation: 'reference',
    tokens: estimateTokens(content),
  };
}

function pickCandidate(candidate: SliceCandidate, remaining: number): SliceCandidate | null {
  if (candidate.tokens <= remaining) return candidate;
  for (const alternate of candidate.alternates ?? []) {
    if (alternate.tokens <= remaining) {
      return {
        ...candidate,
        representation: alternate.representation,
        tokens: alternate.tokens,
        content: alternate.content,
        codemap: alternate.codemap,
      };
    }
  }
  return null;
}

function buildStrategyTotals(candidates: SliceCandidate[]): Record<string, { tokens: number; count: number }> {
  const totals: Record<string, { tokens: number; count: number }> = {};
  for (const candidate of candidates) {
    const entry = totals[candidate.strategy] ?? { tokens: 0, count: 0 };
    entry.tokens += candidate.tokens;
    entry.count += 1;
    totals[candidate.strategy] = entry;
  }
  return totals;
}

function mergeCandidates(candidates: SliceCandidate[]): SliceCandidate[] {
  // Merge candidates by path+strategy to avoid duplicates within the same strategy
  // but allow different strategies to have their own representation of the same file
  const byKey = new Map<string, SliceCandidate>();

  for (const candidate of candidates) {
    const key = `${candidate.strategy}:${candidate.path}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, candidate);
      continue;
    }

    const existingRank = REPRESENTATION_RANK[existing.representation];
    const nextRank = REPRESENTATION_RANK[candidate.representation];

    let chosen = existing;
    if (nextRank > existingRank || (nextRank === existingRank && candidate.score > existing.score)) {
      chosen = candidate;
    }

    const reasons = new Set([existing.reason, candidate.reason].filter(Boolean));
    chosen.reason = Array.from(reasons).join('; ');
    chosen.score = Math.max(existing.score, candidate.score);

    const sources = new Set([existing.source, candidate.source].filter(Boolean));
    chosen.source = Array.from(sources).join('; ');

    byKey.set(key, chosen);
  }

  return Array.from(byKey.values());
}

function upgradeSelectedCandidates(selected: SliceCandidate[], remaining: number): number {
  const upgradeOrder = selected
    .slice()
    .sort(
      (a, b) =>
        REPRESENTATION_RANK[a.representation] - REPRESENTATION_RANK[b.representation] ||
        b.score - a.score ||
        a.tokens - b.tokens
    );

  for (const candidate of upgradeOrder) {
    const alternates = candidate.alternates ?? [];
    if (!alternates.length) continue;

    const better = alternates
      .filter((alt) => REPRESENTATION_RANK[alt.representation] > REPRESENTATION_RANK[candidate.representation])
      .sort(
        (a, b) =>
          REPRESENTATION_RANK[b.representation] - REPRESENTATION_RANK[a.representation] || b.tokens - a.tokens
      );

    for (const alt of better) {
      const delta = alt.tokens - candidate.tokens;
      if (delta <= 0 || delta > remaining) continue;
      candidate.representation = alt.representation;
      candidate.tokens = alt.tokens;
      candidate.content = alt.content;
      candidate.codemap = alt.codemap;
      remaining -= delta;
      break;
    }
  }

  return remaining;
}

function representationToMode(representation: SliceCandidate['representation']): ContextFile['mode'] {
  switch (representation) {
    case 'full':
      return 'full';
    case 'codemap':
      return 'codemap';
    default:
      return 'slice';
  }
}

function isPathIncluded(path: string, request: SliceRequest): boolean {
  if (!request.include?.length && !request.exclude?.length) return true;

  const matches = (patterns: string[]): boolean => {
    for (const pattern of patterns) {
      const regex = globToRegExp(pattern);
      if (regex.test(path)) return true;
    }
    return false;
  };

  if (request.include?.length && !matches(request.include)) return false;
  if (request.exclude?.length && matches(request.exclude)) return false;
  return true;
}

function globToRegExp(glob: string): RegExp {
  let regex = '^';
  let i = 0;
  while (i < glob.length) {
    const char = glob[i];
    if (char === '*') {
      const next = glob[i + 1];
      if (next === '*') {
        regex += '.*';
        i += 2;
      } else {
        regex += '[^/]*';
        i += 1;
      }
      continue;
    }
    if (char === '?') {
      regex += '.';
      i += 1;
      continue;
    }
    regex += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    i += 1;
  }
  regex += '$';
  return new RegExp(regex);
}

async function loadFileContent(fullPath: string): Promise<string | null> {
  try {
    return await readFile(fullPath, 'utf-8');
  } catch {
    return null;
  }
}

async function getGitDiffPaths(repoRoot: string): Promise<string[]> {
  const paths = new Set<string>();
  const commands = [
    ['diff', '--name-only'],
    ['diff', '--name-only', '--cached'],
  ];

  for (const args of commands) {
    const result = await exec('git', args, repoRoot);
    if (result.exitCode !== 0) continue;
    for (const line of result.stdout.split('\n')) {
      const trimmed = line.trim();
      if (trimmed) paths.add(trimmed);
    }
  }

  return Array.from(paths);
}

async function detectProjectName(repoRoot: string): Promise<string | null> {
  if (!repoRoot || repoRoot === '/') return null;

  // Try package.json
  try {
    const pkg = await readFile(join(repoRoot, 'package.json'), 'utf-8');
    const name = JSON.parse(pkg)?.name;
    if (name && typeof name === 'string') return name;
  } catch { /* skip */ }

  // Try Cargo.toml
  try {
    const cargo = await readFile(join(repoRoot, 'Cargo.toml'), 'utf-8');
    const match = cargo.match(/^name\s*=\s*"([^"]+)"/m);
    if (match) return match[1];
  } catch { /* skip */ }

  // Try pyproject.toml
  try {
    const pyproject = await readFile(join(repoRoot, 'pyproject.toml'), 'utf-8');
    const match = pyproject.match(/^name\s*=\s*"([^"]+)"/m);
    if (match) return match[1];
  } catch { /* skip */ }

  return basename(repoRoot) || null;
}

export class SlicerEngine {
  private backend: IvoBackend;

  constructor(backend: IvoBackend) {
    this.backend = backend;
  }

  async plan(request: SliceRequest): Promise<SlicePlan> {
    const budgetTokens = request.budgetTokens || DEFAULT_BUDGET;
    const warningThreshold = request.warningThreshold ?? DEFAULT_WARNING;
    const intensity = normalizeIntensity(request.intensity);
    const strategies = (request.strategies?.length ? request.strategies : DEFAULT_STRATEGIES[intensity]).slice();

    const warnings: string[] = [];
    const candidates: SliceCandidate[] = [];
    const matchedFiles = new Set<string>();
    const explicitPaths = await extractExplicitPaths(request.task, request.repoRoot);
    const rawKeywords = extractKeywords(request.task, 12);
    const baseKeywords = await expandKeywords(rawKeywords, {
      maxKeywords: 20,
      repoRoot: request.repoRoot,
    });

    if (explicitPaths.length > 0) {
      for (const path of explicitPaths) {
        if (!isPathIncluded(path, request)) continue;
        const fullPath = join(request.repoRoot, path);
        const content = await loadFileContent(fullPath);
        if (!content) continue;
        const tokens = estimateTokens(content);
        const alternates: SliceAlternate[] = [makeReferenceAlternate(path, 'explicit reference')];

        if (detectLanguage(path)) {
          const codemap = await extractCodemap(fullPath, content);
          if (codemap) {
            const compact = formatCodemapCompact(codemap);
            alternates.unshift({ representation: 'codemap', tokens: estimateTokens(compact), codemap: compact });
          }
        }

        candidates.push({
          id: `explicit:${path}`,
          path,
          strategy: 'explicit',
          representation: 'full',
          score: scoreCandidate('explicit', 1, tokens, budgetTokens),
          tokens,
          reason: 'Explicit path referenced in task',
          source: 'task',
          content,
          alternates,
        });
        matchedFiles.add(path);
      }
    }

    // Skeleton strategy: find entry points and structural files, produce codemaps
    if (strategies.includes('skeleton')) {
      const skeletonIntensity = resolveIntensity('skeleton', request, intensity);
      const maxSkeletonFiles = skeletonIntensity === 'lite' ? 8 : skeletonIntensity === 'deep' ? 30 : 16;
      const allFiles = await listRepoFiles(request.repoRoot);

      // Find skeleton files: match patterns in priority directories
      const skeletonFiles: string[] = [];
      for (const file of allFiles) {
        if (!isPathIncluded(file, request)) continue;
        const basename = file.split('/').pop() || '';
        const inPriorityDir = SKELETON_DIRS.some(dir => file.includes(dir));

        if (SKELETON_PATTERNS.includes(basename) && inPriorityDir) {
          skeletonFiles.push(file);
        }
      }

      // Extract codemaps for skeleton files
      for (const path of skeletonFiles.slice(0, maxSkeletonFiles)) {
        const fullPath = join(request.repoRoot, path);
        const language = detectLanguage(path);
        if (!language) continue;

        const content = await loadFileContent(fullPath);
        if (!content) continue;

        const codemap = await extractCodemap(fullPath, content);
        if (!codemap) continue;

        const compact = formatCodemapCompact(codemap);
        const tokens = estimateTokens(compact);
        const fullTokens = estimateTokens(content);

        // Alternate: full content if small enough
        const alternates: SliceAlternate[] = [makeReferenceAlternate(path, 'skeleton reference')];
        if (fullTokens <= 2000) {
          alternates.unshift({ representation: 'full', tokens: fullTokens, content });
        }

        candidates.push({
          id: `skeleton:${path}`,
          path,
          strategy: 'skeleton',
          representation: 'codemap',
          score: scoreCandidate('skeleton', 1, tokens, budgetTokens),
          tokens,
          reason: 'Entry point / structural file',
          source: 'skeleton scan',
          codemap: compact,
          alternates,
        });
        matchedFiles.add(path);
      }
    }

    if (strategies.includes('keyword')) {
      const keywordIntensity = resolveIntensity('keyword', request, intensity);
      const keywordLimit = keywordIntensity === 'lite' ? 6 : keywordIntensity === 'deep' ? 14 : 8;
      const keywords = baseKeywords.slice(0, keywordLimit);
      const contextLines = keywordIntensity === 'lite' ? 1 : keywordIntensity === 'deep' ? 4 : 2;
      const maxResults = keywordIntensity === 'lite' ? 40 : keywordIntensity === 'deep' ? 120 : 80;

      if (keywords.length === 0) {
        warnings.push('Keyword strategy skipped: no usable keywords found.');
      } else {
        const matchByFile = await collectKeywordMatches(
          this.backend,
          keywords,
          request,
          { contextLines, maxResults }
        );

        for (const [path, matches] of matchByFile) {
          const fullPath = join(request.repoRoot, path);
          const content = await loadFileContent(fullPath);
          if (!content) continue;
          const lines = content.split('\n');
          const lineNumbers = matches.map((m) => m.line).filter(Boolean);
          const snippet = buildSnippet(path, lines, lineNumbers.slice(0, 6), contextLines);
          const tokens = estimateTokens(snippet);
          const reason = `Keyword hits: ${matches.length}`;

          candidates.push({
            id: `keyword:${path}`,
            path,
            strategy: 'keyword',
            representation: 'snippet',
            score: scoreCandidate('keyword', matches.length, tokens, budgetTokens),
            tokens,
            reason,
            source: 'search',
            content: snippet,
            alternates: [makeReferenceAlternate(path, 'keyword reference')],
          });
          matchedFiles.add(path);
        }
      }
    }

    if (strategies.includes('ast')) {
      const astIntensity = resolveIntensity('ast', request, intensity);
      const astLimit = astIntensity === 'lite' ? 6 : astIntensity === 'deep' ? 24 : 12;
      const keywords = baseKeywords.slice(0, 10);

      if (keywords.length === 0) {
        warnings.push('AST strategy skipped: no usable keywords found.');
      } else {
        const matchByFile = await collectKeywordMatches(
          this.backend,
          keywords,
          request,
          { contextLines: 0, maxResults: astLimit * 10 }
        );

        for (const path of Array.from(matchByFile.keys()).slice(0, astLimit)) {
          const fullPath = join(request.repoRoot, path);
          const language = detectLanguage(path);
          if (!language) continue;
          const codemap = await extractCodemap(fullPath);
          if (!codemap) continue;
          const compact = formatCodemapCompact(codemap);
          const tokens = estimateTokens(compact);

          candidates.push({
            id: `ast:${path}`,
            path,
            strategy: 'ast',
            representation: 'codemap',
            score: scoreCandidate('ast', matchByFile.get(path)?.length ?? 1, tokens, budgetTokens),
            tokens,
            reason: 'AST view for keyword hits',
            source: 'codemap',
            codemap: compact,
            alternates: [makeReferenceAlternate(path, 'ast reference')],
          });
          matchedFiles.add(path);
        }
      }
    }

    if (strategies.includes('diff')) {
      const diffIntensity = resolveIntensity('diff', request, intensity);
      const diffLimit = diffIntensity === 'lite' ? 6 : diffIntensity === 'deep' ? 20 : 12;
      const diffPaths = await getGitDiffPaths(request.repoRoot);

      if (diffPaths.length === 0) {
        warnings.push('Diff strategy skipped: no git changes detected.');
      } else {
        for (const path of diffPaths.slice(0, diffLimit)) {
          if (!isPathIncluded(path, request)) continue;
          const fullPath = join(request.repoRoot, path);
          const content = await loadFileContent(fullPath);
          if (!content) continue;
          const tokens = estimateTokens(content);
          candidates.push({
            id: `diff:${path}`,
            path,
            strategy: 'diff',
            representation: 'full',
            score: scoreCandidate('diff', 1, tokens, budgetTokens),
            tokens,
            reason: 'Recently changed file',
            source: 'git diff',
            content,
            alternates: [makeReferenceAlternate(path, 'diff reference')],
          });
          matchedFiles.add(path);
        }
      }
    }

    if (strategies.includes('symbols')) {
      const symbolIntensity = resolveIntensity('symbols', request, intensity);
      const maxSymbolFiles = symbolIntensity === 'lite' ? 6 : symbolIntensity === 'deep' ? 24 : 14;
      const symbolTargets = Array.from(matchedFiles).slice(0, maxSymbolFiles);

      if (symbolTargets.length === 0) {
        warnings.push('Symbols strategy skipped: no candidate files to extract codemaps.');
      } else {
        const structure = await this.backend.getStructure(symbolTargets, { scope: 'paths' });
        for (const codemap of structure.codemaps) {
          if (!isPathIncluded(codemap.path, request)) continue;
          const compact = formatCodemapCompact(codemap);
          const tokens = estimateTokens(compact);
          candidates.push({
            id: `symbols:${codemap.path}`,
            path: codemap.path,
            strategy: 'symbols',
            representation: 'codemap',
            score: scoreCandidate('symbols', 1, tokens, budgetTokens),
            tokens,
            reason: 'Codemap for referenced file',
            source: 'codemap',
            codemap: compact,
            alternates: [makeReferenceAlternate(codemap.path, 'symbols reference')],
          });
        }
      }
    }

    if (strategies.includes('config')) {
      const configIntensity = resolveIntensity('config', request, intensity);
      const maxConfigTokens = configIntensity === 'lite' ? 800 : configIntensity === 'deep' ? 2400 : 1400;

      for (const path of CONFIG_FILES) {
        if (!isPathIncluded(path, request)) continue;
        const fullPath = join(request.repoRoot, path);
        if (!existsSync(fullPath)) continue;
        const content = await loadFileContent(fullPath);
        if (!content) continue;
        const tokens = estimateTokens(content);

        let representation: SliceCandidate['representation'] = 'full';
        let body = content;

        if (tokens > maxConfigTokens) {
          const lines = content.split('\n');
          body = lines.slice(0, 200).join('\n');
          representation = 'snippet';
        }

        candidates.push({
          id: `config:${path}`,
          path,
          strategy: 'config',
          representation,
          score: scoreCandidate('config', 1, tokens, budgetTokens),
          tokens: estimateTokens(body),
          reason: 'Configuration file',
          source: 'config scan',
          content: body,
          alternates: [makeReferenceAlternate(path, 'config reference')],
        });
      }
    }

    if (strategies.includes('docs')) {
      const docsIntensity = resolveIntensity('docs', request, intensity);
      const docsLimit = docsIntensity === 'lite' ? 8 : docsIntensity === 'deep' ? 30 : 16;
      const keywords = baseKeywords.slice(0, 6);
      const contextLines = docsIntensity === 'lite' ? 1 : docsIntensity === 'deep' ? 4 : 2;
      const maxDocTokens = docsIntensity === 'deep' ? 2400 : 1200;

      const addDocCandidate = async (path: string, reason: string, matches?: SearchMatch[]) => {
        if (!isPathIncluded(path, request)) return;
        const fullPath = join(request.repoRoot, path);
        const content = await loadFileContent(fullPath);
        if (!content) return;
        const tokens = estimateTokens(content);

        let representation: SliceCandidate['representation'] = 'full';
        let body = content;
        let codemapStr: string | undefined;
        if (tokens > maxDocTokens) {
          // Try codemap for markdown files before falling back to truncation
          if (detectLanguage(path) === 'markdown') {
            const codemap = await extractCodemap(fullPath, content);
            if (codemap) {
              body = formatCodemapCompact(codemap);
              representation = 'codemap';
              codemapStr = body;
            }
          }
          if (representation !== 'codemap') {
            const lines = content.split('\n');
            body = lines.slice(0, 200).join('\n');
            representation = 'snippet';
          }
        } else if (detectLanguage(path) === 'markdown') {
          // For small markdown files included in full, generate a codemap alternate
          const codemap = await extractCodemap(fullPath, content);
          if (codemap) {
            codemapStr = formatCodemapCompact(codemap);
          }
        }

        const alternates: SliceAlternate[] = [makeReferenceAlternate(path, 'docs reference')];
        if (codemapStr && representation !== 'codemap') {
          alternates.unshift({ representation: 'codemap', tokens: estimateTokens(codemapStr), codemap: codemapStr });
        }
        if (representation !== 'full' && tokens <= maxDocTokens * 2) {
          alternates.unshift({ representation: 'full', tokens, content });
        }

        const bodyTokens = estimateTokens(body);
        const score = scoreCandidate('docs', matches?.length ?? 1, bodyTokens, budgetTokens);
        candidates.push({
          id: `docs:${path}`,
          path,
          strategy: 'docs',
          representation,
          score,
          tokens: bodyTokens,
          reason,
          source: 'docs',
          content: representation === 'codemap' ? undefined : body,
          codemap: representation === 'codemap' ? codemapStr : undefined,
          alternates,
        });
      };

      // Always include core docs if present.
      for (const path of CORE_DOC_FILES) {
        if (existsSync(join(request.repoRoot, path))) {
          await addDocCandidate(path, 'Core doc');
        }
      }

      if (keywords.length > 0) {
        const matchByFile = await collectKeywordMatches(
          this.backend,
          keywords,
          request,
          { contextLines, maxResults: docsLimit * 10 },
          isDocPath
        );

        for (const [path, matches] of Array.from(matchByFile.entries()).slice(0, docsLimit)) {
          if (CORE_DOC_FILES.includes(path)) continue;
          const fullPath = join(request.repoRoot, path);
          const content = await loadFileContent(fullPath);
          if (!content) continue;
          const lines = content.split('\n');
          const lineNumbers = matches.map((m) => m.line).filter(Boolean);
          const snippet = buildSnippet(path, lines, lineNumbers.slice(0, 6), contextLines);
          const tokens = estimateTokens(snippet);
          const alternates: SliceAlternate[] = [makeReferenceAlternate(path, 'docs reference')];
          const fullTokens = estimateTokens(content);
          if (fullTokens <= maxDocTokens * 2) {
            alternates.unshift({ representation: 'full', tokens: fullTokens, content });
          }

          candidates.push({
            id: `docs:${path}`,
            path,
            strategy: 'docs',
            representation: 'snippet',
            score: scoreCandidate('docs', matches.length, tokens, budgetTokens),
            tokens,
            reason: `Doc hits: ${matches.length}`,
            source: 'search',
            content: snippet,
            alternates,
          });
        }
      } else {
        const docFiles = (await listRepoFiles(request.repoRoot)).filter(isDocPath);
        for (const path of docFiles.slice(0, docsLimit)) {
          if (CORE_DOC_FILES.includes(path)) continue;
          await addDocCandidate(path, 'Doc fallback');
        }
      }
    }

    if (strategies.includes('graph')) {
      const graphIntensity = resolveIntensity('graph', request, intensity);
      const maxGraphFiles = graphIntensity === 'lite' ? 6 : graphIntensity === 'deep' ? 20 : 12;
      const graphDepth = graphIntensity === 'lite' ? 1 : graphIntensity === 'deep' ? 3 : 2;
      const seedFiles = Array.from(matchedFiles);

      if (seedFiles.length === 0) {
        warnings.push('Graph strategy skipped: no seed files from prior strategies.');
      } else {
        const codeFiles = (await listRepoFiles(request.repoRoot)).filter(isCodePath);

        // Performance guard: limit to adjacent directories for large repos
        let filesToAnalyze = codeFiles;
        if (codeFiles.length > 500) {
          const seedDirs = new Set(seedFiles.map((f) => f.split('/').slice(0, -1).join('/')));
          const adjacentDirs = new Set<string>();
          for (const dir of seedDirs) {
            adjacentDirs.add(dir);
            const parent = dir.split('/').slice(0, -1).join('/');
            if (parent) adjacentDirs.add(parent);
          }
          filesToAnalyze = codeFiles.filter((f) => {
            const dir = f.split('/').slice(0, -1).join('/');
            return adjacentDirs.has(dir);
          });
        }

        // Build codemaps for files to analyze
        const structure = await this.backend.getStructure(filesToAnalyze, { scope: 'paths' });

        // Build the import graph
        const graph = buildImportGraph(structure.codemaps, request.repoRoot);

        // BFS from seed files
        const discovered = bfsWalk(graph, seedFiles, graphDepth);

        // Create candidates for newly discovered files
        let graphCount = 0;
        for (const [path, depth] of discovered) {
          if (depth === 0) continue; // Skip seeds themselves
          if (matchedFiles.has(path)) continue;
          if (!isPathIncluded(path, request)) continue;
          if (graphCount >= maxGraphFiles) break;

          const fullPath = join(request.repoRoot, path);
          const language = detectLanguage(path);
          if (!language) continue;

          const codemap = await extractCodemap(fullPath);
          if (!codemap) continue;
          const compact = formatCodemapCompact(codemap);
          const tokens = estimateTokens(compact);
          const depthPenalty = depth * 0.08;
          const score = Math.max(0.05, (STRATEGY_WEIGHTS['graph'] ?? 0.50) - depthPenalty);

          candidates.push({
            id: `graph:${path}`,
            path,
            strategy: 'graph',
            representation: 'codemap',
            score,
            tokens,
            reason: `Import graph: depth ${depth} from keyword matches`,
            source: 'import graph',
            codemap: compact,
            alternates: [makeReferenceAlternate(path, 'graph reference')],
          });
          matchedFiles.add(path);
          graphCount++;
        }
      }
    }

    // Forest strategy: pull knowledge graph context from Forest
    let forestData: { content: string; tokens: number } | undefined;
    if (strategies.includes('forest')) {
      const projectName = await detectProjectName(request.repoRoot);
      const budgetSlice = Math.floor(budgetTokens * (STRATEGY_BUDGET_CAPS.forest ?? 0.25));

      if (budgetSlice < 500) {
        warnings.push('Forest strategy skipped: budget slice too small (< 500 tokens).');
      } else if (!projectName) {
        warnings.push('Forest strategy skipped: could not detect project name.');
      } else {
        const keywords = baseKeywords.slice(0, 10);
        const forestArgs = [
          'context',
          '--tag', `project:${projectName}`,
          '--query', keywords.join(', '),
          '--budget', String(budgetSlice),
        ];
        const forestResult = await exec('forest', forestArgs);

        if (forestResult.exitCode !== 0 || !forestResult.stdout.trim()) {
          warnings.push(`Forest strategy skipped: ${forestResult.stderr.trim() || 'no output from forest CLI'}.`);
        } else {
          const forestTokens = estimateTokens(forestResult.stdout);
          if (forestTokens < 100) {
            warnings.push('Forest strategy skipped: output too small (< 100 tokens).');
          } else {
            forestData = { content: forestResult.stdout, tokens: forestTokens };
          }
        }
      }
    }

    if (strategies.includes('complexity')) {
      const complexityIntensity = resolveIntensity('complexity', request, intensity);
      const limit = complexityIntensity === 'lite' ? 10 : complexityIntensity === 'deep' ? 40 : 20;
      const maxFullTokens = complexityIntensity === 'deep' ? 4000 : 2500;
      const files = await listRepoFiles(request.repoRoot);
      const sizeEntries: Array<{ path: string; size: number }> = [];

      for (const path of files) {
        if (!isPathIncluded(path, request)) continue;
        if (!isCodePath(path)) continue;
        try {
          const stats = await stat(join(request.repoRoot, path));
          sizeEntries.push({ path, size: stats.size });
        } catch {
          // Skip unreadable paths
        }
      }

      sizeEntries.sort((a, b) => b.size - a.size);

      for (const entry of sizeEntries.slice(0, limit)) {
        const fullPath = join(request.repoRoot, entry.path);
        const language = detectLanguage(entry.path);

        if (language) {
          const content = await loadFileContent(fullPath);
          if (!content) continue;
          const fullTokens = estimateTokens(content);
          const codemap = await extractCodemap(fullPath, content);
          if (!codemap) continue;
          const compact = formatCodemapCompact(codemap);
          const tokens = estimateTokens(compact);
          const alternates: SliceAlternate[] = [makeReferenceAlternate(entry.path, 'complexity reference')];
          if (fullTokens <= maxFullTokens) {
            alternates.unshift({ representation: 'full', tokens: fullTokens, content });
          }
          candidates.push({
            id: `complexity:${entry.path}`,
            path: entry.path,
            strategy: 'complexity',
            representation: 'codemap',
            score: scoreCandidate('complexity', 1, tokens, budgetTokens),
            tokens,
            reason: `Large file (${Math.round(entry.size / 1024)}kb)`,
            source: 'size scan',
            codemap: compact,
            alternates,
          });
        } else {
          const reference = makeReferenceAlternate(entry.path, 'complexity reference');
          candidates.push({
            id: `complexity:${entry.path}`,
            path: entry.path,
            strategy: 'complexity',
            representation: 'reference',
            score: scoreCandidate('complexity', 1, reference.tokens, budgetTokens),
            tokens: reference.tokens,
            reason: `Large file (${Math.round(entry.size / 1024)}kb)`,
            source: 'size scan',
          });
        }
      }
    }

    let tree: SliceTree | undefined;
    if (strategies.includes('inventory') || request.includeTree) {
      const treeIntensity = resolveIntensity('inventory', request, intensity);
      const maxDepth = treeIntensity === 'lite' ? 2 : treeIntensity === 'deep' ? 4 : 3;
      try {
        const content = await this.backend.getTree({ maxDepth });
        const tokens = estimateTokens(content);
        tree = { content, tokens };
      } catch {
        warnings.push('Inventory strategy failed: unable to build tree view.');
      }
    }

    const cappedCandidates = applyStrategyCaps(candidates, request);
    const merged = mergeCandidates(cappedCandidates);
    const strategyTotals = buildStrategyTotals(merged);
    const totalTokens = merged.reduce((sum, candidate) => sum + candidate.tokens, 0)
      + (tree?.tokens ?? 0)
      + (forestData?.tokens ?? 0);

    return {
      request: {
        ...request,
        budgetTokens,
        warningThreshold,
        intensity,
        strategies,
      },
      candidates: merged,
      strategyTotals,
      warnings,
      tree,
      forest: forestData,
      totalTokens,
    };
  }

  async assemble(plan: SlicePlan, budgetOverride?: number): Promise<SliceResult> {
    const budgetTokens = budgetOverride ?? plan.request.budgetTokens ?? DEFAULT_BUDGET;
    let remaining = budgetTokens;
    const selected: SliceCandidate[] = [];
    let treeTokens = 0;

    if (plan.tree && plan.tree.tokens <= remaining) {
      treeTokens = plan.tree.tokens;
      remaining -= treeTokens;
    }

    let forestTokens = 0;
    if (plan.forest && plan.forest.tokens <= remaining) {
      forestTokens = plan.forest.tokens;
      remaining -= forestTokens;
    }

    const sorted = rankCandidates(plan);

    // Track per-strategy token usage for budget caps
    const strategyTokens: Record<string, number> = {};
    // Track selected files by representation to allow multiple views of same file
    // e.g., keyword snippet + symbols codemap for the same file
    const selectedByPathRep = new Set<string>();
    const getStrategyBudget = (strategy: SliceStrategy): number => {
      const cap = STRATEGY_BUDGET_CAPS[strategy];
      return cap ? Math.floor(budgetTokens * cap) : budgetTokens;
    };

    for (const candidate of sorted) {
      // Skip if we already selected this file with the same representation
      const pathRepKey = `${candidate.path}:${candidate.representation}`;
      if (selectedByPathRep.has(pathRepKey)) continue;

      // Check strategy budget cap
      const strategyBudget = getStrategyBudget(candidate.strategy);
      const currentUsage = strategyTokens[candidate.strategy] ?? 0;
      const strategyRemaining = strategyBudget - currentUsage;

      // Use the smaller of overall remaining and strategy remaining
      const effectiveRemaining = Math.min(remaining, strategyRemaining);
      if (effectiveRemaining <= 0) continue;

      const picked = pickCandidate(candidate, effectiveRemaining);
      if (!picked) continue;

      selected.push(picked);
      selectedByPathRep.add(`${picked.path}:${picked.representation}`);
      remaining -= picked.tokens;
      strategyTokens[candidate.strategy] = currentUsage + picked.tokens;
      if (remaining <= 0) break;
    }

    if ((plan.request.intensity ?? 'standard') === 'deep' && remaining > 0) {
      remaining = upgradeSelectedCandidates(selected, remaining);
    }

    const files: ContextFile[] = selected.map((candidate) => ({
      path: candidate.path,
      tokens: candidate.tokens,
      mode: representationToMode(candidate.representation),
      content: candidate.representation === 'codemap' ? undefined : candidate.content,
      codemap: candidate.representation === 'codemap' ? candidate.codemap : undefined,
      relevance: Number(candidate.score.toFixed(2)),
      reason: candidate.reason,
      strategy: candidate.strategy,
    }));

    // Build strategy stats from selected candidates
    const strategies: Record<string, { count: number; tokens: number }> = {};
    for (const candidate of selected) {
      const stats = strategies[candidate.strategy] ?? { count: 0, tokens: 0 };
      stats.count++;
      stats.tokens += candidate.tokens;
      strategies[candidate.strategy] = stats;
    }
    // Add tree to inventory if present
    if (plan.tree && treeTokens > 0) {
      const inv = strategies['inventory'] ?? { count: 0, tokens: 0 };
      inv.tokens += treeTokens;
      strategies['inventory'] = inv;
    }
    // Add forest stats if present
    if (plan.forest && forestTokens > 0) {
      strategies['forest'] = { count: 0, tokens: forestTokens };
    }

    const totalTokens = budgetTokens - remaining;
    const context: ContextResult = {
      task: plan.request.task,
      files,
      totalTokens,
      budget: budgetTokens,
      strategies,
      tree: plan.tree && treeTokens > 0 ? plan.tree.content : undefined,
      forest: plan.forest && forestTokens > 0 ? plan.forest.content : undefined,
    };

    return {
      selected,
      totalTokens,
      budgetTokens,
      context,
    };
  }
}

export function createSlicerEngine(backend: IvoBackend): SlicerEngine {
  return new SlicerEngine(backend);
}
