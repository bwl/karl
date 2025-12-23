import path from 'path';
import { promises as fs } from 'fs';
import { Type, type Static, type TSchema } from '@sinclair/typebox';
import { pathToFileURL } from 'url';
import { HookRunner } from './hooks.js';
import type { SchedulerEvent, ToolDiff } from './types.js';
import { ensureDir, formatError, pathExists, resolveHomePath } from './utils.js';

// Types matching pi-agent-core/pi-ai
interface TextContent {
  type: 'text';
  text: string;
}

interface ImageContent {
  type: 'image';
  source: { type: 'base64'; mediaType: string; data: string };
}

interface AgentToolResult<T = any> {
  content: (TextContent | ImageContent)[];
  details: T;
}

interface AgentTool<TParameters extends TSchema = TSchema, TDetails = any> {
  name: string;
  label: string;
  description: string;
  parameters: TParameters;
  execute: (
    toolCallId: string,
    params: Static<TParameters>,
    signal?: AbortSignal,
    onUpdate?: (partialResult: AgentToolResult<TDetails>) => void
  ) => Promise<AgentToolResult<TDetails>>;
}

interface ToolContext {
  cwd: string;
  hooks: HookRunner;
  onEvent?: (event: SchedulerEvent) => void;
  task?: string;
  taskIndex?: number;
  unrestricted?: boolean;
  onDiff?: (diff: ToolDiff) => void;
  diffConfig?: { maxBytes?: number; maxLines?: number };
}

function assertWithinCwd(resolved: string, cwd: string, operation: string): void {
  const normalizedResolved = path.resolve(resolved);
  const normalizedCwd = path.resolve(cwd);
  if (!normalizedResolved.startsWith(normalizedCwd + path.sep) && normalizedResolved !== normalizedCwd) {
    throw new Error(
      `${operation} outside working directory is not allowed: ${resolved}\n` +
      `Use --unrestricted to bypass this check.`
    );
  }
}

function textResult<T>(text: string, details: T): AgentToolResult<T> {
  return {
    content: [{ type: 'text', text }],
    details
  };
}

function imageResult<T>(base64: string, mediaType: string, details: T): AgentToolResult<T> {
  return {
    content: [{ type: 'image', source: { type: 'base64', mediaType, data: base64 } }],
    details
  };
}

type ExecuteFn<T, D> = (params: T) => Promise<AgentToolResult<D>>;

function extractToolDetail(name: string, params: any): string {
  switch (name) {
    case 'bash':
      return params.command?.slice(0, 50) || '';
    case 'read':
      return params.path || '';
    case 'write':
      return params.path || '';
    case 'edit':
      return params.path || '';
    default:
      return '';
  }
}

const DEFAULT_DIFF_BYTES = 20000;
const DEFAULT_DIFF_LINES = 400;

function truncateByBytes(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const buffer = Buffer.from(text);
  if (buffer.byteLength <= maxBytes) {
    return { text, truncated: false };
  }
  return {
    text: Buffer.from(buffer.subarray(0, maxBytes)).toString('utf8'),
    truncated: true
  };
}

function truncateByLines(text: string, maxLines: number): { text: string; truncated: boolean } {
  const lines = text.split(/\r?\n/);
  if (lines.length <= maxLines) {
    return { text, truncated: false };
  }
  return {
    text: lines.slice(0, maxLines).join('\n'),
    truncated: true
  };
}

function normalizeDiffText(text: string, maxBytes: number, maxLines: number): { text: string; truncated: boolean } {
  const byteTrim = truncateByBytes(text, maxBytes);
  const lineTrim = truncateByLines(byteTrim.text, maxLines);
  return {
    text: lineTrim.text,
    truncated: byteTrim.truncated || lineTrim.truncated
  };
}

function buildDiff(pathLabel: string, before: string | undefined, after: string | undefined, truncated: boolean): string {
  const diffLines: string[] = [`--- ${pathLabel}`, `+++ ${pathLabel}`, '@@'];
  if (before !== undefined) {
    for (const line of before.split(/\r?\n/)) {
      diffLines.push(`-${line}`);
    }
  }
  if (after !== undefined) {
    for (const line of after.split(/\r?\n/)) {
      diffLines.push(`+${line}`);
    }
  }
  if (truncated) {
    diffLines.push('@@ truncated');
  }
  return diffLines.join('\n');
}

async function readFileSnapshot(filePath: string, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  const file = Bun.file(filePath);
  const size = file.size;
  if (!size) {
    return { text: '', truncated: false };
  }
  if (size > maxBytes) {
    const buffer = await file.slice(0, maxBytes).arrayBuffer();
    return { text: new TextDecoder().decode(buffer), truncated: true };
  }
  return { text: await file.text(), truncated: false };
}

function wrapExecute<T, D>(
  name: string,
  execute: ExecuteFn<T, D>,
  ctx: ToolContext
): (toolCallId: string, params: T, signal?: AbortSignal) => Promise<AgentToolResult<D>> {
  return async (_toolCallId: string, params: T, _signal?: AbortSignal) => {
    const time = Date.now();
    const detail = extractToolDetail(name, params);
    ctx.onEvent?.({ type: 'tool_start', taskIndex: ctx.taskIndex ?? 0, tool: name, detail, time });
    await ctx.hooks.run('pre-tool', {
      tool: name,
      input: params,
      task: ctx.task,
      index: ctx.taskIndex
    });

    try {
      const result = await execute(params);
      ctx.onEvent?.({
        type: 'tool_end',
        taskIndex: ctx.taskIndex ?? 0,
        tool: name,
        time: Date.now(),
        success: true
      });
      await ctx.hooks.run('post-tool', {
        tool: name,
        input: params,
        output: result,
        success: true,
        task: ctx.task,
        index: ctx.taskIndex
      });
      return result;
    } catch (error) {
      const message = formatError(error);
      ctx.onEvent?.({
        type: 'tool_end',
        taskIndex: ctx.taskIndex ?? 0,
        tool: name,
        time: Date.now(),
        success: false,
        error: message
      });
      await ctx.hooks.run('post-tool', {
        tool: name,
        input: params,
        success: false,
        error: message,
        task: ctx.task,
        index: ctx.taskIndex
      });
      await ctx.hooks.run('on-error', {
        scope: 'tool',
        error: message,
        tool: name,
        task: ctx.task,
        index: ctx.taskIndex
      });
      throw error;
    }
  };
}

async function runShell(command: string, cwd: string, env?: Record<string, string>) {
  const shell = process.env.SHELL ?? '/bin/sh';
  const proc = Bun.spawn([shell, '-lc', command], {
    cwd,
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe'
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  return { stdout, stderr, exitCode };
}

function isBinaryContent(buffer: Uint8Array): boolean {
  for (const byte of buffer) {
    if (byte === 0) {
      return true;
    }
  }
  return false;
}

function detectMime(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.svg':
      return 'image/svg+xml';
    default:
      return null;
  }
}

async function loadFileSlice(filePath: string, offset: number, limit?: number): Promise<Uint8Array> {
  const file = Bun.file(filePath);
  const slice = limit ? file.slice(offset, offset + limit) : file.slice(offset);
  const buffer = await slice.arrayBuffer();
  return new Uint8Array(buffer);
}

async function expandGlob(pattern: string): Promise<string[]> {
  const resolved = resolveHomePath(pattern);
  const hasGlob = /[\*\?\[]/.test(resolved);
  if (!hasGlob) {
    return [resolved];
  }

  if (typeof Bun !== 'undefined' && Bun.Glob) {
    const matches: string[] = [];
    if (path.isAbsolute(resolved)) {
      const root = path.parse(resolved).root;
      const globPattern = resolved.slice(root.length);
      const glob = new Bun.Glob(globPattern);
      for await (const match of glob.scan({ cwd: root })) {
        matches.push(path.join(root, match));
      }
    } else {
      const glob = new Bun.Glob(resolved);
      for await (const match of glob.scan({ cwd: process.cwd() })) {
        matches.push(path.resolve(process.cwd(), match));
      }
    }
    return matches;
  }

  const starIndex = resolved.indexOf('*');
  if (starIndex === -1) {
    return [resolved];
  }
  const dir = path.dirname(resolved);
  if (!(await pathExists(dir))) {
    return [];
  }
  const suffix = resolved.slice(starIndex + 1);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
    .map((entry) => path.join(dir, entry.name));
}

export async function loadCustomTools(patterns: string[], ctx: ToolContext): Promise<AgentTool[]> {
  const tools: AgentTool[] = [];
  const paths: string[] = [];

  for (const pattern of patterns) {
    const expanded = await expandGlob(pattern);
    paths.push(...expanded);
  }

  for (const toolPath of paths) {
    try {
      const mod = await import(pathToFileURL(toolPath).href);
      const tool = mod.default ?? mod;
      if (tool) {
        tools.push(tool);
      }
    } catch (error) {
      const message = formatError(error);
      await ctx.hooks.run('on-error', { scope: 'tool', error: message });
      console.error(`Failed to load custom tool ${toolPath}: ${message}`);
    }
  }

  return tools;
}

// Schemas
const bashSchema = Type.Object({
  command: Type.String({ description: 'Shell command to execute' }),
  cwd: Type.Optional(Type.String({ description: 'Working directory override' })),
  env: Type.Optional(Type.Record(Type.String(), Type.String(), { description: 'Environment overrides' }))
});

const readSchema = Type.Object({
  path: Type.String({ description: 'File path' }),
  offset: Type.Optional(Type.Number({ description: 'Byte offset to start reading from' })),
  limit: Type.Optional(Type.Number({ description: 'Max bytes to read' }))
});

const writeSchema = Type.Object({
  path: Type.String({ description: 'File path' }),
  content: Type.String({ description: 'File contents' })
});

const editSchema = Type.Object({
  path: Type.String({ description: 'File path' }),
  oldText: Type.String({ description: 'Exact text to find' }),
  newText: Type.String({ description: 'Replacement text' })
});

export async function createBuiltinTools(ctx: ToolContext): Promise<AgentTool[]> {
  const bash: AgentTool<typeof bashSchema> = {
    name: 'bash',
    label: 'bash',
    description: 'Execute shell commands. Returns stdout, stderr, and exit code.',
    parameters: bashSchema,
    execute: wrapExecute(
      'bash',
      async (params) => {
        const runCwd = params.cwd ? path.resolve(ctx.cwd, params.cwd) : ctx.cwd;
        const result = await runShell(params.command, runCwd, params.env);
        const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
        return textResult(output || `Exit code: ${result.exitCode}`, result);
      },
      ctx
    )
  };

  const read: AgentTool<typeof readSchema, any> = {
    name: 'read',
    label: 'read',
    description: 'Read file contents. Returns text for text files, base64 for binary/images.',
    parameters: readSchema,
    execute: wrapExecute<Static<typeof readSchema>, any>(
      'read',
      async (params): Promise<AgentToolResult<any>> => {
        const resolved = path.isAbsolute(params.path) ? params.path : path.join(ctx.cwd, params.path);
        const offset = params.offset ?? 0;
        const buffer = await loadFileSlice(resolved, offset, params.limit);
        const mime = detectMime(resolved);
        const binary = mime !== null || isBinaryContent(buffer);

        if (binary && mime) {
          const base64 = Buffer.from(buffer).toString('base64');
          return imageResult(base64, mime, { path: resolved, encoding: 'base64', mime });
        }

        if (binary) {
          const base64 = Buffer.from(buffer).toString('base64');
          return textResult(`[Binary file: ${buffer.length} bytes, base64 encoded]\n${base64}`, {
            path: resolved,
            encoding: 'base64',
            bytes: buffer.length
          });
        }

        const text = new TextDecoder().decode(buffer);
        return textResult(text, { path: resolved, encoding: 'utf8', bytes: buffer.length });
      },
      ctx
    )
  };

  const write: AgentTool<typeof writeSchema> = {
    name: 'write',
    label: 'write',
    description: 'Create or overwrite a file. Creates parent directories if needed.',
    parameters: writeSchema,
    execute: wrapExecute(
      'write',
      async (params) => {
        const resolved = path.isAbsolute(params.path) ? params.path : path.join(ctx.cwd, params.path);
        if (!ctx.unrestricted) {
          assertWithinCwd(resolved, ctx.cwd, 'Writing');
        }
        const maxBytes = ctx.diffConfig?.maxBytes ?? DEFAULT_DIFF_BYTES;
        const maxLines = ctx.diffConfig?.maxLines ?? DEFAULT_DIFF_LINES;
        let beforeSnapshot: { text: string; truncated: boolean } | undefined;
        if (await pathExists(resolved)) {
          const snapshot = await readFileSnapshot(resolved, maxBytes);
          const normalized = normalizeDiffText(snapshot.text, maxBytes, maxLines);
          beforeSnapshot = {
            text: normalized.text,
            truncated: snapshot.truncated || normalized.truncated
          };
        }

        const afterSnapshot = normalizeDiffText(params.content, maxBytes, maxLines);

        await ensureDir(path.dirname(resolved));
        await Bun.write(resolved, params.content);
        const bytes = Buffer.byteLength(params.content);
        if (ctx.onDiff) {
          const truncated = (beforeSnapshot?.truncated ?? false) || afterSnapshot.truncated;
          const diff = buildDiff(resolved, beforeSnapshot?.text, afterSnapshot.text, truncated);
          ctx.onDiff({
            path: resolved,
            tool: 'write',
            ts: Date.now(),
            before: beforeSnapshot?.text,
            after: afterSnapshot.text,
            diff,
            truncated
          });
        }
        return textResult(`Wrote ${bytes} bytes to ${resolved}`, { path: resolved, bytesWritten: bytes });
      },
      ctx
    )
  };

  const edit: AgentTool<typeof editSchema> = {
    name: 'edit',
    label: 'edit',
    description: 'Edit a file by replacing exact text. oldText must match exactly.',
    parameters: editSchema,
    execute: wrapExecute(
      'edit',
      async (params) => {
        const resolved = path.isAbsolute(params.path) ? params.path : path.join(ctx.cwd, params.path);
        if (!ctx.unrestricted) {
          assertWithinCwd(resolved, ctx.cwd, 'Editing');
        }
        const maxBytes = ctx.diffConfig?.maxBytes ?? DEFAULT_DIFF_BYTES;
        const maxLines = ctx.diffConfig?.maxLines ?? DEFAULT_DIFF_LINES;
        const content = await Bun.file(resolved).text();

        if (!content.includes(params.oldText)) {
          throw new Error(`oldText not found in ${resolved}`);
        }

        const newContent = content.replace(params.oldText, params.newText);
        await Bun.write(resolved, newContent);

        const diff = params.oldText.length - params.newText.length;
        if (ctx.onDiff) {
          const beforeSnapshot = normalizeDiffText(params.oldText, maxBytes, maxLines);
          const afterSnapshot = normalizeDiffText(params.newText, maxBytes, maxLines);
          const truncated = beforeSnapshot.truncated || afterSnapshot.truncated;
          const diffText = buildDiff(resolved, beforeSnapshot.text, afterSnapshot.text, truncated);
          ctx.onDiff({
            path: resolved,
            tool: 'edit',
            ts: Date.now(),
            before: beforeSnapshot.text,
            after: afterSnapshot.text,
            diff: diffText,
            truncated
          });
        }
        return textResult(`Edited ${resolved}: replaced ${params.oldText.length} chars with ${params.newText.length} chars`, {
          path: resolved,
          charDiff: diff
        });
      },
      ctx
    )
  };

  // Cast to any[] to avoid TypeScript issues with heterogeneous tool parameter types
  return [bash, read, write, edit] as AgentTool<any, any>[];
}
