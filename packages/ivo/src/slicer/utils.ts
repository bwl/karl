/**
 * Shared Slicer Utilities — helpers used by strategy plugins and engine
 */

import { spawn } from 'child_process';
import { readFile, stat } from 'fs/promises';
import { join, relative } from 'path';
import type { IvoBackend } from '../backends/types.js';
import type { SearchMatch } from '../types.js';
import type { SliceAlternate, SliceCandidate, SliceRequest, SliceStrategy } from './types.js';

// ============================================================================
// Constants (shared across strategies)
// ============================================================================

export const STOPWORDS = new Set([
  'the', 'and', 'or', 'to', 'for', 'a', 'an', 'of', 'in', 'on',
  'is', 'are', 'this', 'that', 'with', 'by', 'add', 'fix', 'update',
  'change', 'refactor', 'improve', 'make', 'build', 'review',
]);

export const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.rs', '.py', '.go'];

export const CONFIG_FILES = [
  'package.json', 'tsconfig.json', 'tsconfig.base.json', 'bunfig.toml',
  'bun.lock', 'bun.lockb', 'vite.config.ts', 'vitest.config.ts',
  'jest.config.js', 'tsup.config.ts', 'rollup.config.js', '.env.example',
  'pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt',
  'go.mod', 'go.sum', 'Cargo.toml', 'Makefile',
];

export const SKELETON_PATTERNS = [
  'cli.ts', 'cli.js', 'main.ts', 'main.js', 'mod.ts', 'mod.rs',
  'index.ts', 'index.js', 'lib.rs', 'main.go', '__init__.py', '__main__.py',
  'types.ts', 'types.js', 'interfaces.ts',
  'app.ts', 'app.js', 'server.ts', 'server.js', 'app.py', 'setup.py',
];

export const SKELETON_DIRS = ['src/', 'lib/', 'packages/'];

export const CORE_DOC_FILES = [
  'AGENTS.md', 'AGENT_SKILLS_IMPLEMENTATION.md', 'agentskills.md',
  'README.md', 'README', 'CLAUDE.md', 'stack.md',
];

export const DOC_PATH_HINTS = [
  'ideas/', 'status/', 'megamerge_docs/', 'docs/',
  'README', 'readme', 'AGENTS.md', 'CLAUDE.md', '.md',
];

/** Default strategy weights (used for scoring) */
export const STRATEGY_WEIGHTS: Record<string, number> = {
  explicit: 0.95,
  skeleton: 0.90,
  keyword: 0.65,
  semantic: 0.55,
  symbols: 0.55,
  graph: 0.50,
  config: 0.45,
  diff: 0.6,
  inventory: 0.2,
  ast: 0.5,
  complexity: 0.4,
  docs: 0.30,
  forest: 0.70,
};

/** Default strategy budget caps (fraction of total budget) */
export const STRATEGY_BUDGET_CAPS: Record<string, number> = {
  keyword: 0.20,
  diff: 0.10,
  graph: 0.15,
  semantic: 0.15,
  docs: 0.10,
  forest: 0.25,
};

// ============================================================================
// Exec helper
// ============================================================================

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function exec(cmd: string, args: string[], cwd?: string): Promise<ExecResult> {
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

// ============================================================================
// Token / path helpers
// ============================================================================

export function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4);
}

export function isDocPath(path: string): boolean {
  return DOC_PATH_HINTS.some((hint) => path.includes(hint));
}

export function isCodePath(path: string): boolean {
  const lower = path.toLowerCase();
  return CODE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function isPathIncluded(path: string, request: SliceRequest): boolean {
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

// ============================================================================
// File I/O
// ============================================================================

export async function listRepoFiles(repoRoot: string): Promise<string[]> {
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

export async function loadFileContent(fullPath: string): Promise<string | null> {
  try {
    return await readFile(fullPath, 'utf-8');
  } catch {
    return null;
  }
}

// ============================================================================
// Candidate building helpers
// ============================================================================

export function scoreCandidate(
  strategy: string,
  matchCount: number,
  tokens: number,
  budget: number
): number {
  const base = STRATEGY_WEIGHTS[strategy] ?? 0.3;
  const matchBoost = Math.min(0.25, matchCount * 0.03);
  const sizePenalty = Math.min(0.2, tokens / (budget * 2));
  return Math.max(0.05, base + matchBoost - sizePenalty);
}

export function makeReferenceAlternate(path: string, reason: string): SliceAlternate {
  const content = `${path} (${reason})`;
  return {
    representation: 'reference',
    tokens: estimateTokens(content),
  };
}

export function buildSnippet(path: string, lines: string[], lineNumbers: number[], context: number): string {
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

export function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
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

export function extractKeywords(task: string, max: number): string[] {
  const words = task
    .toLowerCase()
    .match(/[a-z0-9_\-./]+/g)
    ?.filter((word) => word.length >= 3 && !STOPWORDS.has(word)) ?? [];

  const unique = Array.from(new Set(words));
  return unique.slice(0, max);
}

// ============================================================================
// Keyword search helper (shared by keyword, ast, docs strategies)
// ============================================================================

export async function collectKeywordMatches(
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

// ============================================================================
// Git helpers
// ============================================================================

export async function getGitDiffPaths(repoRoot: string): Promise<string[]> {
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

// ============================================================================
// Project detection
// ============================================================================

export async function detectProjectName(repoRoot: string): Promise<string | null> {
  if (!repoRoot || repoRoot === '/') return null;

  try {
    const pkg = await readFile(join(repoRoot, 'package.json'), 'utf-8');
    const name = JSON.parse(pkg)?.name;
    if (name && typeof name === 'string') return name;
  } catch { /* skip */ }

  try {
    const cargo = await readFile(join(repoRoot, 'Cargo.toml'), 'utf-8');
    const match = cargo.match(/^name\s*=\s*"([^"]+)"/m);
    if (match) return match[1];
  } catch { /* skip */ }

  try {
    const pyproject = await readFile(join(repoRoot, 'pyproject.toml'), 'utf-8');
    const match = pyproject.match(/^name\s*=\s*"([^"]+)"/m);
    if (match) return match[1];
  } catch { /* skip */ }

  const { basename } = await import('path');
  return basename(repoRoot) || null;
}
