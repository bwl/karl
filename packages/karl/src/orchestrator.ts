/**
 * Karl Orchestrator
 *
 * Interactive agent that orchestrates work through karl CLI calls.
 * Inspired by pi-agent patterns but focused on karl orchestration.
 */

import { spawn } from 'child_process';
import { existsSync, promises as fs, readdirSync, type Dirent } from 'fs';
import { basename, join, relative, resolve, sep } from 'path';
import { agentLoop, type AgentLoopConfig, type ToolDefinition, type Message } from './agent-loop.js';
import type { KarlConfig } from './types.js';
import { resolveAgentModel } from './config.js';
import { getProviderOAuthToken } from './oauth.js';
import { StackManager } from './stacks.js';

// ============================================================================
// Types
// ============================================================================

export interface OrchestratorState {
  messages: Message[];
  model: string;      // The raw model ID
  modelAlias: string; // The user-configured alias
  provider: string;
  isStreaming: boolean;
}

export interface KarlInvocation {
  command: string;
  argsPrefix: string[];
  display: string;
}

export interface OrchestratorOptions {
  karlInvocation?: KarlInvocation;
}

export type OrchestratorEvent =
  | { type: 'thinking'; text: string }
  | { type: 'ivo_start'; task: string }
  | { type: 'ivo_end'; contextId: string; files: number; tokens: number; budget: number }
  | { type: 'agent_tool_start'; tool: string; detail: string }
  | { type: 'agent_tool_end'; tool: string; summary: string; success: boolean; durationMs: number }
  | { type: 'karl_start'; command: string; task: string }
  | { type: 'karl_output'; chunk: string }
  | { type: 'karl_end'; result: string; success: boolean; durationMs: number }
  | { type: 'response'; text: string }
  | { type: 'usage'; tokens: { input?: number; output?: number; total?: number } }
  | { type: 'error'; error: Error }
  | { type: 'done' };

type Listener = (event: OrchestratorEvent) => void;

function splitCommandLine(input: string): string[] {
  const parts = input.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  return parts.map(part => {
    if (
      (part.startsWith('"') && part.endsWith('"')) ||
      (part.startsWith("'") && part.endsWith("'"))
    ) {
      return part.slice(1, -1);
    }
    return part;
  });
}

export function resolveKarlInvocation(): KarlInvocation {
  const override = process.env.KARL_AGENT_COMMAND?.trim();
  if (override) {
    const parts = splitCommandLine(override);
    if (parts.length > 0) {
      return {
        command: parts[0],
        argsPrefix: parts.slice(1),
        display: override,
      };
    }
  }

  const execPath = process.execPath;
  const entrypoint = process.argv[1];
  const entrypointName = entrypoint ? basename(entrypoint) : '';
  const hasSeparateEntrypoint =
    entrypoint &&
    entrypoint !== execPath &&
    !entrypoint.startsWith('/$bunfs/') &&
    existsSync(entrypoint) &&
    (
      entrypoint.endsWith('/src/cli.ts') ||
      entrypoint.endsWith('/dist/karl') ||
      entrypoint.endsWith('/dist/karl.js') ||
      entrypoint.endsWith('/karl') ||
      entrypointName === 'cli.ts'
    );

  if (hasSeparateEntrypoint) {
    return {
      command: execPath,
      argsPrefix: [entrypoint],
      display: `${basename(execPath)} ${entrypoint}`,
    };
  }

  return {
    command: execPath,
    argsPrefix: [],
    display: execPath,
  };
}

// ============================================================================
// System Prompt
// ============================================================================

const ORCHESTRATOR_SYSTEM_PROMPT = `You are a strategic coordinator. You accomplish goals with quick local reconnaissance and focused delegation to Karl, a capable coding agent.

## How This Works

You think about WHAT needs to happen. Use your read-only workspace tools for cheap context, then delegate substantial work to Karl.

When you want implementation, file mutation, shell commands, tests, builds, commits, or deeper investigation, use the karl() tool and describe what you want in plain English. Karl has access to the filesystem, git, shell commands, and code editing - you don't need to specify the exact commands.

## Examples of Good Delegation

User: "Review changes and commit them in logical chunks"
You think: This is a multi-step task - review what changed, group related changes, commit with good messages
You call: karl("run", "Review all uncommitted changes, group them by logical unit, and create separate commits for each group with descriptive messages")

User: "Fix the authentication bug"
You think: Karl needs to find the bug, understand the auth system, then fix it
You call: karl("run", "Investigate and fix the authentication bug - look at recent changes and error logs to identify the issue")

User: "Add dark mode support"
You think: This is a feature request - Karl should figure out the implementation
You call: karl("run", "Add dark mode support to the application - determine the best approach for this codebase and implement it")

## Your Tools

**karl(command, task)** - Delegate complex work to Karl
- command: Use "run" for normal delegation. Only use a different command when the user has an explicitly configured Karl stack with that exact name.
- task: Describe what you want done in natural language. Be clear about the goal, not the steps.

**karl_cli(args)** - Manage karl configuration and coordination
- Use for: stacks, models, skills, providers, and other meta-operations
- Examples: "stacks list", "stacks create review", "models list", "skills list", "info"
- NOT for actual work - use karl() to delegate grep, read, bash, code changes, etc.

**list_files(path, depth)** - Quickly inspect directory structure
- Use for: ls/tree style reconnaissance before deciding what to delegate.
- Keep depth small unless the user asks for a broad inventory.

**read_file(path, startLine, maxLines)** - Read a bounded slice of a text file
- Use for: README, docs, indexes, manifests, and other small context checks.
- Do not use it to manually perform large code review or implementation.

**search_files(query, path, glob)** - Search workspace text with ripgrep
- Use for: finding wiki pages, TODOs, feature names, symbols, or recent notes.
- Prefer this over delegating a "grep for X" task to Karl.

**ivo_context(keywords)** - Pre-load codebase context (optional)
- Use when Karl needs broad context across many files
- Pass comma-separated keywords/synonyms
- Returns a context_id to pass to karl()

## Key Principles

1. **Use local tools for cheap context** - List directories, read indexes, and search text yourself when it helps frame the task.

2. **Delegate outcomes, not procedures** - Say "fix the login bug" not "run grep for login, then read the file, then edit line 42"

3. **Trust Karl's judgment** - Karl knows how to use git, read files, and write code. You focus on the goal.

4. **Think in tasks, not commands** - One karl() call can accomplish a lot. Don't micromanage.

5. **Be specific about WHAT, vague about HOW** - "Commit changes in logical groups" is good. "Run git add then git commit" is micromanaging.

6. **Avoid noisy preambles** - If you are about to use a tool, either use it immediately or give one short orientation sentence. Do not repeat "I'd be happy to help" style filler.

7. **Recover narrowly** - If a Karl delegation fails or hits a tool limit, do not retry the same broad task. Inspect with local tools, narrow the task, or explain the blocker.

8. **Do not echo Karl verbatim** - After a successful Karl call, give the user a brief synthesis or next step. Do not repeat Karl's full output unless the user asks for raw details.`;

const AGENT_CONTEXT_FILES = [
  '.karl/agent.md',
  '.karl/agent-context.md',
  'WORKFLOW.md',
  'AGENTS.md',
  'CLAUDE.md',
  'MAINTENANCE.md',
  '.karl/context.md',
];

const MAX_AGENT_CONTEXT_CHARS = 64_000;
const SHALLOW_AGENT_CONTEXT_NAMES = new Set(['AGENTS.md', 'CLAUDE.md', 'WORKFLOW.md', 'MAINTENANCE.md']);
const AGENT_CONTEXT_IGNORED_DIRS = new Set([
  '.git',
  '.karl',
  '.ivo',
  '.codex',
  '.agents',
  '.claude',
  '.next',
  '.turbo',
  '.cache',
  'node_modules',
  'dist',
  'build',
  'coverage',
]);

function agentContextPriority(file: string): number {
  const name = basename(file);
  if (file === '.karl/agent.md') return 0;
  if (file === '.karl/agent-context.md') return 1;
  if (file === 'WORKFLOW.md') return 2;
  if (file === 'AGENTS.md') return 3;
  if (file === 'CLAUDE.md') return 4;
  if (file === 'MAINTENANCE.md') return 5;
  if (file === '.karl/context.md') return 6;
  if (name === 'WORKFLOW.md') return 20;
  if (name === 'AGENTS.md') return 21;
  if (name === 'CLAUDE.md') return 22;
  if (name === 'MAINTENANCE.md') return 23;
  return 100;
}

function pathDepth(file: string): number {
  return file.split('/').length;
}

function normalizeRelPath(file: string): string {
  return file.split(sep).join('/');
}

function discoverShallowAgentContextFiles(root: string, maxDepth = 3): string[] {
  const found: string[] = [];

  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) return;

    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const rel = normalizeRelPath(relative(root, fullPath));
      if (entry.isDirectory()) {
        if (AGENT_CONTEXT_IGNORED_DIRS.has(entry.name)) continue;
        walk(fullPath, depth + 1);
      } else if (entry.isFile() && SHALLOW_AGENT_CONTEXT_NAMES.has(entry.name) && !AGENT_CONTEXT_FILES.includes(rel)) {
        found.push(rel);
      }
    }
  };

  walk(root, 1);
  return found.sort((a, b) =>
    agentContextPriority(a) - agentContextPriority(b) ||
    pathDepth(a) - pathDepth(b) ||
    a.localeCompare(b)
  );
}

export function discoverAgentContextFiles(cwd = process.cwd()): string[] {
  const root = resolve(cwd);
  const hasAgents = existsSync(join(root, 'AGENTS.md'));
  const files: string[] = [];
  const seen = new Set<string>();

  for (const file of AGENT_CONTEXT_FILES) {
    if (file === 'CLAUDE.md' && hasAgents) continue;
    if (existsSync(join(root, file))) {
      files.push(file);
      seen.add(file);
    }
  }

  for (const file of discoverShallowAgentContextFiles(root)) {
    if (!seen.has(file)) {
      files.push(file);
      seen.add(file);
    }
  }

  return files.sort((a, b) =>
    agentContextPriority(a) - agentContextPriority(b) ||
    pathDepth(a) - pathDepth(b) ||
    a.localeCompare(b)
  );
}

async function loadAgentProjectContext(cwd = process.cwd()): Promise<{ text: string; files: string[]; truncated: boolean }> {
  const root = resolve(cwd);
  const files = discoverAgentContextFiles(root);
  const sections: string[] = [];
  let usedChars = 0;
  let truncated = false;

  for (const file of files) {
    const fullPath = join(root, file);
    let content = '';
    try {
      content = (await fs.readFile(fullPath, 'utf8')).trim();
    } catch {
      continue;
    }
    if (!content) continue;

    const header = `### ${file}\n`;
    let section = `${header}${content}`;
    const remaining = MAX_AGENT_CONTEXT_CHARS - usedChars;
    if (remaining <= header.length + 200) {
      truncated = true;
      break;
    }
    if (section.length > remaining) {
      section = `${header}${content.slice(0, remaining - header.length)}\n\n[truncated: use read_file for more of ${file}]`;
      truncated = true;
    }

    sections.push(section);
    usedChars += section.length;
    if (truncated) break;
  }

  return {
    files,
    text: sections.join('\n\n'),
    truncated,
  };
}


// ============================================================================
// Ivo Context Tool
// ============================================================================

type Emitter = (event: OrchestratorEvent) => void;

/**
 * Check if ivo CLI is available on PATH.
 */
let ivoAvailable: boolean | null = null;

async function isIvoAvailable(): Promise<boolean> {
  if (ivoAvailable !== null) return ivoAvailable;
  try {
    const proc = spawn('ivo', ['--version'], { stdio: 'pipe' });
    const code = await new Promise<number | null>((resolve) => {
      proc.on('close', resolve);
      proc.on('error', () => resolve(null));
    });
    ivoAvailable = code === 0;
  } catch {
    ivoAvailable = false;
  }
  return ivoAvailable;
}

interface IvoResult {
  contextId: string;
  files: number;
  tokens: number;
  budget: number;
}

/**
 * Get path to ivo context file.
 */
function getIvoContextPath(contextId: string): string {
  return join(process.cwd(), '.ivo', 'contexts', `${contextId}.xml`);
}

/**
 * Call ivo context and parse the output.
 * ivo saves context to .ivo/contexts/{id}.xml and outputs:
 * "a7b2c3d  45 files  28.5k tokens  (89% of 32k)"
 */
async function runIvoContext(keywords: string, budget: number): Promise<IvoResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('ivo', ['context', keywords, '--budget', String(budget)], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0' }
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `ivo exited with code ${code}`));
        return;
      }

      // Parse output: "a7b2c3d  45 files  28.5k tokens  (89% of 32k)"
      const idMatch = stdout.match(/^([a-f0-9]{7})/);
      const filesMatch = stdout.match(/(\d+)\s+files/);
      const tokensMatch = stdout.match(/([\d.]+)k?\s+tokens/);

      if (!idMatch) {
        reject(new Error('Failed to parse context ID from ivo output'));
        return;
      }

      const contextId = idMatch[1];
      const files = filesMatch ? parseInt(filesMatch[1], 10) : 0;
      let tokens = 0;
      if (tokensMatch) {
        const val = parseFloat(tokensMatch[1]);
        tokens = tokensMatch[0].includes('k') ? Math.round(val * 1000) : Math.round(val);
      }

      resolve({ contextId, files, tokens, budget });
    });

    child.on('error', (error) => {
      reject(new Error(`Error spawning ivo: ${error.message}`));
    });
  });
}

function createIvoContextTool(emit: Emitter): ToolDefinition {
  return {
    name: 'ivo_context',
    description: 'Pre-load codebase context for complex multi-file tasks. Returns a context_id to pass to karl(). Only use when Karl needs broad context across many files.',
    parameters: {
      type: 'object',
      properties: {
        keywords: {
          type: 'string',
          description: 'Comma-separated keywords to search for. Include synonyms for better coverage.'
        },
        budget: {
          type: 'number',
          description: 'Token budget limit (default: 32000)'
        }
      },
      required: ['keywords']
    },
    execute: async (_toolCallId, params) => {
      const { keywords, budget = 32000 } = params as { keywords: string; budget?: number };

      // Check if ivo is installed
      if (!await isIvoAvailable()) {
        return {
          content: [{ type: 'text', text: 'ivo is not installed. Install it with: bun install -g ivo (or add it to PATH). Proceeding without codebase context.' }],
          isError: true
        };
      }

      emit({ type: 'ivo_start', task: keywords });

      try {
        const result = await runIvoContext(keywords, budget);

        emit({
          type: 'ivo_end',
          contextId: result.contextId,
          files: result.files,
          tokens: result.tokens,
          budget
        });

        const budgetUsage = budget > 0 ? `${((result.tokens / budget) * 100).toFixed(0)}%` : 'N/A';
        return {
          content: [{
            type: 'text',
            text: `Context ready: ${result.contextId}\nFiles: ${result.files} | Tokens: ${result.tokens}/${budget} (${budgetUsage})`
          }]
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        emit({ type: 'ivo_end', contextId: '', files: 0, tokens: 0, budget });
        return {
          content: [{ type: 'text', text: `Error gathering context: ${message}` }],
          isError: true
        };
      }
    }
  };
}

// ============================================================================
// Read-only Workspace Tools
// ============================================================================

const SKIPPED_DIRS = new Set([
  '.git',
  '.next',
  '.turbo',
  '.cache',
  '.pytest_cache',
  '.ruff_cache',
  'node_modules',
  'dist',
  'build',
  'coverage',
]);

function resolveWorkspacePath(input: string | undefined): string {
  const cwd = resolve(process.cwd());
  const target = input && input.trim() ? input.trim() : '.';
  const resolved = resolve(cwd, target);
  if (resolved !== cwd && !resolved.startsWith(cwd + sep)) {
    throw new Error(`Path is outside the current workspace: ${target}`);
  }
  return resolved;
}

function workspaceRelative(filePath: string): string {
  const rel = relative(process.cwd(), filePath);
  return rel || '.';
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function firstTextLine(result: Array<{ type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; mediaType: string; data: string } }>): string {
  const text = result.find((entry): entry is { type: 'text'; text: string } => entry.type === 'text')?.text ?? '';
  return text.split(/\r?\n/).find(Boolean) ?? '(no output)';
}

function formatAgentToolDetail(toolName: string, args: any): string {
  if (toolName === 'list_files') {
    const path = typeof args.path === 'string' && args.path ? args.path : '.';
    const depth = typeof args.depth === 'number' ? ` depth ${args.depth}` : '';
    return `${path}${depth}`;
  }
  if (toolName === 'read_file') {
    const path = typeof args.path === 'string' ? args.path : '';
    const startLine = typeof args.startLine === 'number' ? `:${args.startLine}` : '';
    return `${path}${startLine}`;
  }
  if (toolName === 'search_files') {
    const query = typeof args.query === 'string' ? args.query : '';
    const path = typeof args.path === 'string' && args.path ? args.path : '.';
    return `${JSON.stringify(query)} in ${path}`;
  }
  return '';
}

async function collectDirectoryLines(params: {
  root: string;
  maxDepth: number;
  maxEntries: number;
  includeHidden: boolean;
}): Promise<{ lines: string[]; truncated: boolean }> {
  const lines: string[] = [];
  let truncated = false;

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (truncated) return;

    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (truncated) return;
      if (!params.includeHidden && entry.name.startsWith('.')) continue;
      if (entry.isDirectory() && SKIPPED_DIRS.has(entry.name)) continue;

      const fullPath = join(dir, entry.name);
      const rel = workspaceRelative(fullPath);
      lines.push(entry.isDirectory() ? `${rel}/` : rel);

      if (lines.length >= params.maxEntries) {
        truncated = true;
        return;
      }

      if (entry.isDirectory() && depth < params.maxDepth) {
        await walk(fullPath, depth + 1);
      }
    }
  };

  await walk(params.root, 1);
  return { lines, truncated };
}

function createListFilesTool(): ToolDefinition {
  return {
    name: 'list_files',
    description: 'List files and directories inside the current workspace. Read-only. Use for quick ls/tree style reconnaissance before delegating larger work.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory or file path relative to the workspace. Defaults to ".".' },
        depth: { type: 'number', description: 'Directory recursion depth, 1-4. Defaults to 1.' },
        maxEntries: { type: 'number', description: 'Maximum entries to return, 1-500. Defaults to 120.' },
        includeHidden: { type: 'boolean', description: 'Include hidden files. Defaults to true, excluding heavy cache dirs.' }
      }
    },
    execute: async (_toolCallId, params) => {
      const input = params as { path?: string; depth?: number; maxEntries?: number; includeHidden?: boolean };
      const resolved = resolveWorkspacePath(input.path);
      const stat = await fs.stat(resolved);
      const rel = workspaceRelative(resolved);

      if (!stat.isDirectory()) {
        return {
          content: [{ type: 'text', text: `Path is a file: ${rel}\nSize: ${stat.size} bytes` }]
        };
      }

      const maxDepth = clampNumber(input.depth, 1, 1, 4);
      const maxEntries = clampNumber(input.maxEntries, 120, 1, 500);
      const includeHidden = input.includeHidden ?? true;
      const { lines, truncated } = await collectDirectoryLines({
        root: resolved,
        maxDepth,
        maxEntries,
        includeHidden,
      });
      const header = `Listed ${lines.length}${truncated ? '+' : ''} entries under ${rel} (depth ${maxDepth})`;
      const body = lines.length > 0 ? lines.join('\n') : '(empty)';
      return {
        content: [{
          type: 'text',
          text: `${header}\n${body}${truncated ? `\n... truncated at ${maxEntries} entries` : ''}`
        }]
      };
    }
  };
}

function createReadFileTool(): ToolDefinition {
  return {
    name: 'read_file',
    description: 'Read a bounded slice of a text file inside the current workspace. Read-only. Use for README files, wiki indexes, manifests, and focused context checks.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Text file path relative to the workspace.' },
        startLine: { type: 'number', description: '1-based start line. Defaults to 1.' },
        maxLines: { type: 'number', description: 'Maximum lines to return, 1-1000. Defaults to 200.' }
      },
      required: ['path']
    },
    execute: async (_toolCallId, params) => {
      const input = params as { path: string; startLine?: number; maxLines?: number };
      const resolved = resolveWorkspacePath(input.path);
      const stat = await fs.stat(resolved);
      if (!stat.isFile()) {
        throw new Error(`Not a file: ${workspaceRelative(resolved)}`);
      }
      if (stat.size > 2_000_000) {
        throw new Error(`File is too large for read_file (${stat.size} bytes): ${workspaceRelative(resolved)}`);
      }

      const content = await fs.readFile(resolved, 'utf8');
      const lines = content.split(/\r?\n/);
      const startLine = clampNumber(input.startLine, 1, 1, Math.max(1, lines.length));
      const maxLines = clampNumber(input.maxLines, 200, 1, 1000);
      const selected = lines.slice(startLine - 1, startLine - 1 + maxLines);
      const endLine = startLine + selected.length - 1;
      const numbered = selected
        .map((line, index) => `${String(startLine + index).padStart(4, ' ')} | ${line}`)
        .join('\n');
      const truncated = endLine < lines.length;

      return {
        content: [{
          type: 'text',
          text: `Read ${workspaceRelative(resolved)} lines ${startLine}-${endLine} of ${lines.length}${truncated ? ' (more available)' : ''}\n${numbered}`
        }]
      };
    }
  };
}

async function runRipgrep(args: string[], signal?: AbortSignal): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolveResult) => {
    const child = spawn('rg', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0' }
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const maxBytes = 240_000;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, 10_000);

    const abortHandler = () => {
      child.kill('SIGTERM');
    };
    signal?.addEventListener('abort', abortHandler);

    child.stdout?.on('data', (data: Buffer) => {
      if (Buffer.byteLength(stdout) < maxBytes) stdout += data.toString();
    });

    child.stderr?.on('data', (data: Buffer) => {
      if (Buffer.byteLength(stderr) < maxBytes) stderr += data.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abortHandler);
      resolveResult({ code, stdout, stderr, timedOut });
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abortHandler);
      resolveResult({ code: null, stdout, stderr: error.message, timedOut });
    });
  });
}

function createSearchFilesTool(): ToolDefinition {
  return {
    name: 'search_files',
    description: 'Search workspace text with ripgrep. Read-only. Use for finding wiki pages, TODOs, feature names, symbols, docs, or recent notes before delegating larger work.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Regex query by default; set literal=true for exact text.' },
        path: { type: 'string', description: 'Directory or file path relative to the workspace. Defaults to ".".' },
        glob: { type: 'string', description: 'Optional ripgrep glob, such as "*.md" or "morley-wiki/**/*.md".' },
        literal: { type: 'boolean', description: 'Treat query as literal text instead of a regex. Defaults to false.' },
        maxMatches: { type: 'number', description: 'Maximum result lines to return, 1-300. Defaults to 80.' }
      },
      required: ['query']
    },
    execute: async (_toolCallId, params, signal) => {
      const input = params as { query: string; path?: string; glob?: string; literal?: boolean; maxMatches?: number };
      if (!input.query || !input.query.trim()) {
        throw new Error('search_files requires a non-empty query');
      }

      const resolved = resolveWorkspacePath(input.path);
      const maxMatches = clampNumber(input.maxMatches, 80, 1, 300);
      const args = [
        '--line-number',
        '--column',
        '--hidden',
        '--smart-case',
        '--color',
        'never',
        '--glob',
        '!.git/**',
        '--glob',
        '!node_modules/**',
        '--glob',
        '!dist/**',
        '--glob',
        '!*.bun-build',
      ];

      if (input.literal) args.push('--fixed-strings');
      if (input.glob) args.push('--glob', input.glob);
      args.push(input.query, resolved);

      const result = await runRipgrep(args, signal);
      if (result.code === null) {
        return {
          content: [{ type: 'text', text: `search_files failed: ${result.stderr || 'could not spawn rg'}` }],
          isError: true
        };
      }
      if (result.timedOut) {
        return {
          content: [{ type: 'text', text: `search_files timed out after 10s for ${JSON.stringify(input.query)}` }],
          isError: true
        };
      }
      if (result.code === 1) {
        return {
          content: [{ type: 'text', text: `No matches for ${JSON.stringify(input.query)} in ${workspaceRelative(resolved)}` }]
        };
      }
      if (result.code !== 0) {
        return {
          content: [{ type: 'text', text: `search_files failed: ${result.stderr || `rg exited with ${result.code}`}` }],
          isError: true
        };
      }

      const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
      const selected = lines.slice(0, maxMatches);
      const truncated = lines.length > selected.length;
      return {
        content: [{
          type: 'text',
          text: `Found ${lines.length}${truncated ? '+' : ''} matches for ${JSON.stringify(input.query)} in ${workspaceRelative(resolved)}\n${selected.join('\n')}${truncated ? `\n... truncated at ${maxMatches} matches` : ''}`
        }]
      };
    }
  };
}

// ============================================================================
// Karl Tool
// ============================================================================

const BUILTIN_KARL_COMMANDS = new Set([
  'run',
  'ask',
  'do',
  'execute',
  'exec',
  'continue',
  'cont',
  'followup',
  'follow-up',
  'chain',
]);

function createKarlTool(
  emit: Emitter,
  karlInvocation: KarlInvocation,
  allowedCommands: Set<string>,
  signal?: AbortSignal
): ToolDefinition {
  return {
    name: 'karl',
    description: 'Delegate a task to Karl, a capable coding agent. Describe what you want done in natural language - Karl handles the details. Karl can read/write files, run shell commands, use git, and edit code.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Use "run" unless the user has configured an exact Karl stack name.'
        },
        task: {
          type: 'string',
          description: 'What you want Karl to accomplish, in natural language. Focus on the goal, not the steps.'
        },
        context_id: {
          type: 'string',
          description: 'Optional context ID from ivo_context() for complex multi-file tasks.'
        },
        flags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Additional flags (rarely needed)'
        }
      },
      required: ['command', 'task']
    },
    execute: async (_toolCallId, params) => {
      const { command: requestedCommand, task, context_id, flags = [] } = params as {
        command: string;
        task: string;
        context_id?: string;
        flags?: string[];
      };
      const command = allowedCommands.has(requestedCommand) ? requestedCommand : 'run';
      const startTime = Date.now();

      emit({ type: 'karl_start', command, task });

      return new Promise((resolve) => {
        const args = [...karlInvocation.argsPrefix, command, task, ...flags];

        // Add context file if context_id provided (loads from .ivo/contexts/)
        if (context_id) {
          const contextPath = getIvoContextPath(context_id);
          args.push('--context-file', contextPath);
        }

        const child = spawn(karlInvocation.command, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, FORCE_COLOR: '0' }
        });

        let stdout = '';
        let stderr = '';

        child.stdout?.on('data', (data: Buffer) => {
          const chunk = data.toString();
          stdout += chunk;
          emit({ type: 'karl_output', chunk });
        });

        child.stderr?.on('data', (data: Buffer) => {
          const chunk = data.toString();
          stderr += chunk;
          emit({ type: 'karl_output', chunk });
        });

        // Handle abort
        const abortHandler = () => {
          child.kill('SIGTERM');
        };
        signal?.addEventListener('abort', abortHandler);

        child.on('close', (code) => {
          signal?.removeEventListener('abort', abortHandler);
          const success = code === 0;
          const result = stdout || stderr || `(no output, exit code: ${code})`;
          const durationMs = Date.now() - startTime;

          emit({ type: 'karl_end', result, success, durationMs });

          resolve({
            content: [{ type: 'text', text: result }],
            isError: !success
          });
        });

        child.on('error', (error) => {
          signal?.removeEventListener('abort', abortHandler);
          const durationMs = Date.now() - startTime;
          emit({ type: 'karl_end', result: error.message, success: false, durationMs });

          resolve({
            content: [{ type: 'text', text: `Error spawning Karl via ${karlInvocation.display}: ${error.message}` }],
            isError: true
          });
        });
      });
    }
  };
}

// ============================================================================
// Karl CLI Tool (configuration and coordination)
// ============================================================================

function createKarlCliTool(emit: Emitter, karlInvocation: KarlInvocation, signal?: AbortSignal): ToolDefinition {
  return {
    name: 'karl_cli',
    description: 'Manage karl configuration and coordination. Use for stacks, models, skills, providers, and meta-operations. NOT for actual work - use karl() to delegate grep, read, bash, code changes.',
    parameters: {
      type: 'object',
      properties: {
        args: {
          type: 'string',
          description: 'Karl CLI command. Examples: "stacks list", "stacks create review", "models list", "skills list", "providers list", "info"'
        }
      },
      required: ['args']
    },
    execute: async (_toolCallId, params) => {
      const { args } = params as { args: string };
      const startTime = Date.now();

      // Parse args string into array (simple split, handles quoted strings later if needed)
      const argList = splitCommandLine(args);
      const command = argList[0] || 'help';

      emit({ type: 'karl_start', command, task: args });

      return new Promise((resolve) => {
        const child = spawn(karlInvocation.command, [...karlInvocation.argsPrefix, ...argList], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, FORCE_COLOR: '0' }
        });

        let stdout = '';
        let stderr = '';

        child.stdout?.on('data', (data: Buffer) => {
          const chunk = data.toString();
          stdout += chunk;
          emit({ type: 'karl_output', chunk });
        });

        child.stderr?.on('data', (data: Buffer) => {
          const chunk = data.toString();
          stderr += chunk;
          emit({ type: 'karl_output', chunk });
        });

        // Handle abort
        const abortHandler = () => {
          child.kill('SIGTERM');
        };
        signal?.addEventListener('abort', abortHandler);

        child.on('close', (code) => {
          signal?.removeEventListener('abort', abortHandler);
          const success = code === 0;
          const result = stdout || stderr || `(no output, exit code: ${code})`;
          const durationMs = Date.now() - startTime;

          emit({ type: 'karl_end', result, success, durationMs });

          resolve({
            content: [{ type: 'text', text: result }],
            isError: !success
          });
        });

        child.on('error', (error) => {
          signal?.removeEventListener('abort', abortHandler);
          const durationMs = Date.now() - startTime;
          emit({ type: 'karl_end', result: error.message, success: false, durationMs });

          resolve({
            content: [{ type: 'text', text: `Error spawning Karl via ${karlInvocation.display}: ${error.message}` }],
            isError: true
          });
        });
      });
    }
  };
}

// ============================================================================
// Orchestrator Class
// ============================================================================

export class Orchestrator {
  private state: OrchestratorState;
  private listeners = new Set<Listener>();
  private abortController: AbortController | null = null;
  private config: KarlConfig;
  private karlInvocation: KarlInvocation;

  constructor(config: KarlConfig, options: OrchestratorOptions = {}) {
    this.config = config;
    this.karlInvocation = options.karlInvocation ?? resolveKarlInvocation();

    const resolved = resolveAgentModel(config);
    this.state = {
      messages: [],
      model: resolved.model,
      modelAlias: resolved.modelKey,
      provider: resolved.providerKey,
      isStreaming: false
    };
  }

  /**
   * Get current state (read-only snapshot)
   */
  get snapshot(): Readonly<OrchestratorState> {
    return { ...this.state };
  }

  /**
   * Subscribe to events
   */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: OrchestratorEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener errors
      }
    }
  }

  private async getAllowedKarlCommands(): Promise<Set<string>> {
    const stackNames = new Set(Object.keys(this.config.stacks ?? {}));
    try {
      const manager = new StackManager(this.config);
      const stacks = await manager.listStacks();
      for (const stack of stacks) {
        stackNames.add(stack.name);
      }
    } catch {
      // Stack discovery is advisory for the coordinator prompt/tool schema.
    }

    return new Set([
      ...BUILTIN_KARL_COMMANDS,
      ...stackNames,
    ]);
  }

  private async buildSystemPrompt(): Promise<string> {
    const projectContext = await loadAgentProjectContext();
    if (!projectContext.text) {
      return ORCHESTRATOR_SYSTEM_PROMPT;
    }

    const fileList = projectContext.files.join(', ');
    const truncationNote = projectContext.truncated
      ? '\n\nProject context was truncated. Use read_file when you need a deeper section.'
      : '';

    return `${ORCHESTRATOR_SYSTEM_PROMPT}

## Project Operating Context

The following local project guidance is loaded before each turn. Treat it as project-specific orchestration law when it is more specific than the generic Karl Agent instructions.

Loaded files: ${fileList}${truncationNote}

${projectContext.text}`;
  }

  /**
   * Send a prompt and stream responses
   */
  async prompt(userMessage: string): Promise<void> {
    if (this.state.isStreaming) {
      throw new Error('Already streaming - call abort() first');
    }

    this.state.isStreaming = true;
    this.abortController = new AbortController();

    // Add user message to history
    this.state.messages.push({ role: 'user', content: userMessage });

    try {
      const resolved = resolveAgentModel(this.config);

      // Resolve API key based on auth type
      let apiKey: string | null | undefined;
      if (resolved.providerConfig.authType === 'oauth') {
        apiKey = await getProviderOAuthToken(resolved.providerKey);
      } else {
        apiKey = resolved.providerConfig.apiKey;
      }

      if (!apiKey || apiKey.includes('${')) {
        throw new Error(`No credentials found for provider: ${resolved.providerKey}`);
      }

      // Determine provider type and base URL
      const providerType = resolved.providerConfig.type === 'anthropic' ? 'anthropic' : 'openai';
      let baseUrl = resolved.providerConfig.baseUrl;

      // Default baseUrl for Anthropic providers
      if (!baseUrl && providerType === 'anthropic') {
        baseUrl = 'https://api.anthropic.com';
      }

      if (!baseUrl) {
        throw new Error(`No baseUrl for provider: ${resolved.providerKey}`);
      }

      const loopConfig: AgentLoopConfig = {
        model: resolved.model,
        baseUrl,
        apiKey,
        providerType,
        requestBody: resolved.request,
        maxToolRounds: 100,  // High limit since orchestrator uses karl tool calls for everything
        signal: this.abortController.signal,
        // Enable extended thinking for orchestrator (benefits from deep reasoning)
        // max_tokens must be > thinking.budgetTokens per Anthropic API requirements
        thinking: providerType === 'anthropic' ? { type: 'enabled', budgetTokens: 8192 } : undefined,
        maxTokens: providerType === 'anthropic' ? 16384 : undefined,
        // Enable prompt caching for cost savings
        cacheControl: providerType === 'anthropic'
      };

      // Tools: ivo_context, karl (agent), and karl_cli (utility)
      const emit = (event: OrchestratorEvent) => this.emit(event);
      const signal = this.abortController.signal;
      const localToolStarts = new Map<string, number>();
      const allowedKarlCommands = await this.getAllowedKarlCommands();

      const tools = [
        createListFilesTool(),
        createReadFileTool(),
        createSearchFilesTool(),
        createIvoContextTool(emit),
        createKarlTool(emit, this.karlInvocation, allowedKarlCommands, signal),
        createKarlCliTool(emit, this.karlInvocation, signal)
      ];

      // Build full message history for agent loop
      // Note: agentLoop takes systemPrompt + userMessage, but we need multi-turn
      // We'll concatenate previous messages into the user message for now
      const historyContext = this.buildHistoryContext();
      const fullPrompt = historyContext
        ? `${historyContext}\n\nUser: ${userMessage}`
        : userMessage;

      const loop = agentLoop(
        await this.buildSystemPrompt(),
        fullPrompt,
        tools,
        loopConfig
      );

      let responseText = '';

      while (true) {
        const { value, done } = await loop.next();

        if (done) {
          // Generator returned
          break;
        }

        const event = value;

        switch (event.type) {
          case 'tool_execution_start':
            if (!['karl', 'karl_cli', 'ivo_context'].includes(event.toolName)) {
              localToolStarts.set(event.toolCallId, Date.now());
              this.emit({
                type: 'agent_tool_start',
                tool: event.toolName,
                detail: formatAgentToolDetail(event.toolName, event.args)
              });
            }
            break;

          case 'tool_execution_end':
            if (!['karl', 'karl_cli', 'ivo_context'].includes(event.toolName)) {
              const start = localToolStarts.get(event.toolCallId) ?? Date.now();
              localToolStarts.delete(event.toolCallId);
              this.emit({
                type: 'agent_tool_end',
                tool: event.toolName,
                summary: firstTextLine(event.result.content).slice(0, 160),
                success: !event.isError,
                durationMs: Date.now() - start
              });
            }
            break;

          case 'text_delta':
            responseText += event.delta;
            this.emit({ type: 'thinking', text: event.delta });
            break;

          case 'text_end':
            responseText = event.text;
            break;

          case 'turn_end':
            // Emit usage if available
            if (event.usage) {
              this.emit({ type: 'usage', tokens: event.usage });
            }
            // Add assistant response to history
            if (event.message.content) {
              this.state.messages.push({
                role: 'assistant',
                content: event.message.content
              });
              this.emit({ type: 'response', text: event.message.content });
            }
            break;

          case 'message_end':
            // Emit usage for each message (intermediate turns)
            if (event.usage) {
              this.emit({ type: 'usage', tokens: event.usage });
            }
            break;

          case 'error':
            throw event.error;
        }
      }

      this.emit({ type: 'done' });
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        this.emit({ type: 'error', error: error as Error });
      }
      throw error;
    } finally {
      this.state.isStreaming = false;
      this.abortController = null;
    }
  }

  /**
   * Abort current streaming operation
   */
  abort(): void {
    this.abortController?.abort();
  }

  /**
   * Reset conversation history
   */
  reset(): void {
    this.state.messages = [];
    this.abort();
  }

  /**
   * Build context from previous messages for multi-turn
   */
  private buildHistoryContext(): string {
    if (this.state.messages.length <= 1) {
      return '';
    }

    // Skip the last message (it's the current user message we're about to send)
    const history = this.state.messages.slice(0, -1);
    if (history.length === 0) {
      return '';
    }

    return history
      .map((msg) => {
        const role = msg.role === 'user' ? 'User' : 'Assistant';
        return `${role}: ${msg.content}`;
      })
      .join('\n\n');
  }
}
