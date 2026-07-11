/**
 * karl magic — delegate tasks to Codex app-server
 *
 * Usage:
 *   karl magic "task description"
 *   karl magic -v "task"         # verbose (reasoning + command output)
 *   karl magic -q "task"         # quiet (final answer only)
 *   karl magic -c "follow up"    # resume last thread
 *   karl magic --persist "task"   # create a persistent Codex app thread
 *   karl magic -m model "task"   # model override
 *   karl magic --effort high     # lower reasoning effort (default: max)
 *   karl magic --json "task"     # JSON output
 *   karl magic --worktree "task" # run in a detached scratch worktree
 */

import { homedir, tmpdir } from 'os';
import { basename, join, resolve } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import pc from 'picocolors';
import { Spinner } from '../spinner.js';
import { CodexClient, type CodexEvent } from '../magic-client.js';
import { loadConfig } from '../config.js';
import { buildHistoryId, createHistoryStore, type HistoryThinkingEntry } from '../history.js';
import { StatusWriter } from '../status.js';
import type { HistoryConfig, TokenUsage, ToolDiff } from '../types.js';

// ── Arg parsing ─────────────────────────────────────────────────────────

interface CodexOptions {
  verbose: boolean;
  quiet: boolean;
  model?: string;
  cwd: string;
  instructions?: string;
  continue: boolean;
  persist: boolean;
  schema?: string;
  effort?: string;
  json: boolean;
  stats: boolean;
  receipt: boolean;
  noHistory: boolean;
  requireClean: boolean;
  worktree: boolean;
  worktreeDir?: string;
  task: string | null;
}

interface CommandRecord {
  command: string;
  cwd: string;
  startedAt: number;
  exitCode?: number | null;
  durationMs?: number | null;
}

interface WorktreeInfo {
  sourceCwd: string;
  repoRoot: string;
  path: string;
  head: string;
  bootstrapNote?: string;
}

interface MagicReceipt {
  id: string;
  status: 'success' | 'error';
  cwd: string;
  sourceCwd?: string;
  worktree?: string;
  threadId?: string | null;
  model?: string;
  reasoningEffort: string;
  durationMs: number;
  commands: CommandRecord[];
  filesChanged: string[];
  tokens?: TokenUsage;
  error?: string;
}

const REASONING_EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
export const MAGIC_MODELS = {
  luna: 'gpt-5.6-luna',
  sol: 'gpt-5.6-sol',
} as const;
const DEFAULT_MAGIC_MODEL = MAGIC_MODELS.luna;
const DEFAULT_REASONING_EFFORT = 'max';

export function resolveMagicModel(model?: string): string {
  if (!model) return DEFAULT_MAGIC_MODEL;
  return MAGIC_MODELS[model.toLowerCase() as keyof typeof MAGIC_MODELS] ?? model;
}

function normalizeEffort(effort?: string): string {
  const normalized = (effort ?? DEFAULT_REASONING_EFFORT).toLowerCase();
  return normalized === 'off' ? 'none' : normalized;
}

function formatEffortForDisplay(effort: string): string {
  return effort === 'none' ? 'off' : effort;
}

function parseArgs(args: string[]): CodexOptions {
  const opts: CodexOptions = {
    verbose: false,
    quiet: false,
    cwd: process.cwd(),
    continue: false,
    persist: false,
    json: false,
    stats: false,
    receipt: false,
    noHistory: false,
    requireClean: false,
    worktree: false,
    task: null,
  };

  const positional: string[] = [];
  let i = 0;

  while (i < args.length) {
    const arg = args[i];
    switch (arg) {
      case '-v': case '--verbose':
        opts.verbose = true; break;
      case '-q': case '--quiet':
        opts.quiet = true; break;
      case '-c': case '--continue':
        opts.continue = true;
        opts.persist = true;
        break;
      case '--persist':
        opts.persist = true; break;
      case '-j': case '--json':
        opts.json = true; break;
      case '--stats':
        opts.stats = true; break;
      case '--receipt':
        opts.receipt = true; break;
      case '--no-history':
        opts.noHistory = true; break;
      case '--require-clean':
        opts.requireClean = true; break;
      case '--worktree':
        opts.worktree = true; break;
      case '--worktree-dir':
        opts.worktree = true;
        opts.worktreeDir = args[++i];
        break;
      case '-m': case '--model':
        opts.model = args[++i]; break;
      case '--luna':
        opts.model = 'luna'; break;
      case '--sol':
        opts.model = 'sol'; break;
      case '--cwd':
        opts.cwd = args[++i]; break;
      case '--instructions': case '--system':
        opts.instructions = args[++i]; break;
      case '--schema':
        opts.schema = args[++i]; break;
      case '--effort':
        opts.effort = args[++i]; break;
      default:
        if (!arg.startsWith('-')) {
          positional.push(arg);
        }
    }
    i++;
  }

  // Task from positional args or stdin marker
  if (positional.length > 0) {
    if (positional[0] === '-') {
      opts.task = null; // signal to read stdin
    } else {
      opts.task = positional.join(' ');
    }
  }

  return opts;
}

async function readStdin(): Promise<string> {
  const chunks: string[] = [];
  const reader = Bun.stdin.stream().getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(decoder.decode(value, { stream: true }));
  }
  return chunks.join('').trim();
}

// ── Thread persistence ──────────────────────────────────────────────────

const THREAD_FILE = join(homedir(), '.config', 'karl', 'magic-last-thread.json');

function loadLastThread(cwd: string): { threadId: string } | null {
  try {
    const data = JSON.parse(readFileSync(THREAD_FILE, 'utf-8'));
    if (data.cwd === cwd) return data;
    return null;
  } catch { return null; }
}

function saveLastThread(cwd: string, threadId: string): void {
  try {
    mkdirSync(join(homedir(), '.config', 'karl'), { recursive: true });
    writeFileSync(THREAD_FILE, JSON.stringify({ threadId, cwd, updatedAt: Date.now() }) + '\n');
  } catch { /* best effort */ }
}

// ── Local safety / receipt helpers ──────────────────────────────────────

function decodeProcessOutput(output: unknown): string {
  if (!output) return '';
  if (typeof output === 'string') return output;
  if (output instanceof Uint8Array) return new TextDecoder().decode(output);
  return String(output);
}

function runGit(cwd: string, args: string[]): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(['git', '-C', cwd, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    exitCode: result.exitCode ?? 1,
    stdout: decodeProcessOutput(result.stdout).trim(),
    stderr: decodeProcessOutput(result.stderr).trim(),
  };
}

function readGitStatus(cwd: string): { ok: true; lines: string[] } | { ok: false; error: string } {
  const result = runGit(cwd, ['status', '--porcelain']);
  if (result.exitCode !== 0) {
    return { ok: false, error: result.stderr || result.stdout || 'not a git worktree' };
  }
  return { ok: true, lines: result.stdout ? result.stdout.split('\n').filter(Boolean) : [] };
}

function assertCleanGitTree(cwd: string): void {
  const status = readGitStatus(cwd);
  if (!status.ok) {
    throw new Error(`--require-clean needs a git worktree: ${status.error}`);
  }
  if (status.lines.length === 0) {
    return;
  }
  const sample = status.lines.slice(0, 12).map((line) => `  ${line}`).join('\n');
  const suffix = status.lines.length > 12 ? `\n  ... ${status.lines.length - 12} more` : '';
  throw new Error(`Working tree is not clean:\n${sample}${suffix}`);
}

function defaultWorktreeParent(): string {
  return existsSync('/private/tmp') ? '/private/tmp' : tmpdir();
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'repo';
}

function readWorktreeNote(repoRoot: string): string | undefined {
  const notePath = join(repoRoot, '.karl', 'worktree.md');
  try {
    const text = readFileSync(notePath, 'utf-8').trim();
    return text || undefined;
  } catch {
    return undefined;
  }
}

function prepareWorktree(sourceCwd: string, historyId: string, parentDir?: string): WorktreeInfo {
  const rootResult = runGit(sourceCwd, ['rev-parse', '--show-toplevel']);
  if (rootResult.exitCode !== 0 || !rootResult.stdout) {
    throw new Error(`--worktree needs a git repository: ${rootResult.stderr || rootResult.stdout}`);
  }

  const headResult = runGit(sourceCwd, ['rev-parse', '--short', 'HEAD']);
  if (headResult.exitCode !== 0 || !headResult.stdout) {
    throw new Error(`Could not resolve HEAD for --worktree: ${headResult.stderr || headResult.stdout}`);
  }

  const repoRoot = rootResult.stdout;
  const parent = resolve(parentDir ?? defaultWorktreeParent());
  mkdirSync(parent, { recursive: true });
  const worktreePath = join(parent, `karl-${slugify(basename(repoRoot))}-${historyId}`);
  const addResult = runGit(repoRoot, ['worktree', 'add', '--detach', worktreePath, 'HEAD']);
  if (addResult.exitCode !== 0) {
    throw new Error(`Could not create worktree at ${worktreePath}: ${addResult.stderr || addResult.stdout}`);
  }

  return {
    sourceCwd,
    repoRoot,
    path: worktreePath,
    head: headResult.stdout,
    bootstrapNote: readWorktreeNote(repoRoot),
  };
}

function appendWorktreeInstructions(instructions: string | undefined, worktree: WorktreeInfo | null): string | undefined {
  if (!worktree?.bootstrapNote) {
    return instructions;
  }
  const note = [
    `Project worktree notes from ${join(worktree.repoRoot, '.karl', 'worktree.md')}:`,
    worktree.bootstrapNote,
  ].join('\n');
  return [instructions, note].filter(Boolean).join('\n\n');
}

function createStatusWriter(cwd: string, task: string, historyId: string): StatusWriter | null {
  try {
    return new StatusWriter(cwd, task, historyId);
  } catch {
    return null;
  }
}

async function createMagicHistoryStore(cwd: string, quiet: boolean, json: boolean): Promise<{
  store: ReturnType<typeof createHistoryStore>;
  config?: HistoryConfig;
}> {
  try {
    const config = await loadConfig(cwd);
    return { store: createHistoryStore(config.history, cwd), config: config.history };
  } catch (error) {
    if (!quiet && !json) {
      process.stderr.write(pc.dim(`history config unavailable: ${(error as Error).message}\n`));
    }
    return { store: createHistoryStore(undefined, cwd), config: undefined };
  }
}

function truncateDiff(diff: string, config?: HistoryConfig): ToolDiff {
  const maxBytes = config?.maxDiffBytes ?? 20000;
  const maxLines = config?.maxDiffLines ?? 400;
  const lines = diff.split('\n');
  let text = lines.length > maxLines ? lines.slice(0, maxLines).join('\n') : diff;
  let truncated = text.length !== diff.length;
  if (text.length > maxBytes) {
    text = text.slice(0, maxBytes);
    truncated = true;
  }
  return {
    path: '(codex turn diff)',
    tool: 'edit',
    ts: Date.now(),
    diff: text,
    truncated,
  };
}

function tokenUsageFromEvent(event: CodexEvent | null): TokenUsage | undefined {
  if (!event || event.type !== 'token_usage') {
    return undefined;
  }
  return {
    input: event.input,
    output: event.output,
    total: event.total,
  };
}

function compactList(values: string[], max = 5): string {
  if (values.length === 0) {
    return 'none reported';
  }
  if (values.length <= max) {
    return values.join(', ');
  }
  return `${values.slice(0, max).join(', ')} +${values.length - max} more`;
}

function printReceipt(receipt: MagicReceipt): void {
  const failed = receipt.commands.filter((command) => command.exitCode != null && command.exitCode !== 0);
  const validation = failed.length > 0
    ? `${failed.length} command(s) failed inside delegate run`
    : receipt.commands.length > 0
      ? 'delegate commands completed; gate independently before integrating'
      : 'no command telemetry; gate manually before integrating';

  process.stderr.write(pc.dim(`\nreceipt ${receipt.id}\n`));
  process.stderr.write(`Decision: ${receipt.status}${receipt.error ? ` (${receipt.error})` : ''}\n`);
  process.stderr.write(`Files: ${compactList(receipt.filesChanged)}\n`);
  process.stderr.write(`Evidence: ${receipt.commands.length} command(s), ${receipt.durationMs}ms, ${receipt.tokens?.total ?? 0} tokens\n`);
  process.stderr.write(`Validation: ${validation}\n`);
  process.stderr.write(`Residual risk: human diff/test gate still owns integration\n`);
  if (receipt.worktree) {
    process.stderr.write(`Worktree: ${receipt.worktree}\n`);
  }
}

// ── Command handler ─────────────────────────────────────────────────────

export async function handleMagicCommand(args: string[]): Promise<void> {
  const opts = parseArgs(args);

  // Read task
  let task = opts.task;
  if (task === null) {
    if (!process.stdin.isTTY) {
      task = await readStdin();
    }
  }

  if (!task) {
    console.error('Usage: karl magic "task description"');
    console.error('');
    console.error('Flags:');
    console.error('  -v, --verbose       Full event stream (reasoning, commands, diffs)');
    console.error('  -q, --quiet         Print only final answer');
    console.error('  -c, --continue      Resume last thread');
    console.error('  --persist           Create a persistent Codex app thread');
    console.error('  --luna              Use GPT-5.6 Luna (default)');
    console.error('  --sol               Use GPT-5.6 Sol for the hardest tasks');
    console.error('  -m, --model MODEL   Use luna, sol, or an explicit Codex model ID');
    console.error('  -j, --json          JSON output');
    console.error('  --cwd PATH          Override working directory');
    console.error('  --instructions STR  Developer instructions');
    console.error('  --schema FILE       JSON Schema for structured output');
    console.error('  --effort LEVEL      Reasoning effort (none/off/minimal/low/medium/high/xhigh/max/ultra; default max)');
    console.error('  --stats             Print token usage');
    console.error('  --receipt           Print a five-line delegate receipt');
    console.error('  --require-clean     Fail if --cwd has uncommitted git changes');
    console.error('  --worktree          Run from a detached scratch git worktree');
    console.error('  --worktree-dir DIR  Parent directory for --worktree');
    console.error('  --no-history        Skip history DB recording');
    process.exitCode = 1;
    return;
  }

  const sourceCwd = resolve(opts.cwd);
  opts.cwd = sourceCwd;

  const model = resolveMagicModel(opts.model);
  const effort = normalizeEffort(opts.effort);
  if (!REASONING_EFFORTS.has(effort)) {
    console.error(`Invalid --effort value: ${opts.effort}`);
    console.error('Expected one of: none, off, minimal, low, medium, high, xhigh, max, ultra');
    process.exitCode = 1;
    return;
  }
  if (effort === 'ultra' && model === MAGIC_MODELS.luna) {
    console.error('Reasoning effort "ultra" is only available with Sol. Use `--sol --effort ultra`.');
    process.exitCode = 1;
    return;
  }

  // Load output schema if provided
  let outputSchema: unknown = undefined;
  if (opts.schema) {
    try {
      outputSchema = JSON.parse(await Bun.file(opts.schema).text());
    } catch (e: any) {
      console.error(`Failed to load schema from ${opts.schema}: ${e.message}`);
      process.exitCode = 1;
      return;
    }
  }

  const runStartedAt = Date.now();
  const historyId = buildHistoryId(new Date(runStartedAt));
  // A scratch run must not create live-status files in the source worktree.
  // Its durable journal and child process output remain available instead.
  const statusWriter = opts.worktree ? null : createStatusWriter(sourceCwd, task, historyId);
  const history = opts.noHistory
    ? { store: null, config: undefined }
    : await createMagicHistoryStore(sourceCwd, opts.quiet, opts.json);

  let worktreeInfo: WorktreeInfo | null = null;
  let runCwd = sourceCwd;
  try {
    if (opts.requireClean) {
      assertCleanGitTree(sourceCwd);
    }

    if (opts.worktree) {
      if (!opts.requireClean && !opts.quiet && !opts.json) {
        const status = readGitStatus(sourceCwd);
        if (status.ok && status.lines.length > 0) {
          process.stderr.write(pc.dim('source tree is dirty; scratch worktree will use HEAD only\n'));
        }
      }
      worktreeInfo = prepareWorktree(sourceCwd, historyId, opts.worktreeDir);
      runCwd = worktreeInfo.path;
      if (!opts.quiet && !opts.json) {
        process.stderr.write(pc.dim(`worktree ${runCwd}\n`));
        if (worktreeInfo.bootstrapNote) {
          process.stderr.write(pc.dim('loaded .karl/worktree.md\n'));
        }
      }
    }
  } catch (e: any) {
    const message = e?.message ?? String(e);
    statusWriter?.onError(message, Date.now() - runStartedAt);
    console.error(`${pc.red('magic error:')} ${message}`);
    process.exitCode = 1;
    return;
  }

  const effectiveInstructions = appendWorktreeInstructions(opts.instructions, worktreeInfo);
  const client = new CodexClient({
    cwd: runCwd,
    model,
    instructions: effectiveInstructions,
    approvalPolicy: 'never',
    effort,
    outputSchema,
    ephemeral: !opts.persist,
  });

  // SIGINT handler
  let interrupted = false;
  const sigintHandler = async () => {
    if (interrupted) {
      // Second SIGINT — force exit
      process.exit(130);
    }
    interrupted = true;
    process.stderr.write(pc.dim('\nInterrupting...\n'));
    await client.interrupt();
    setTimeout(() => {
      client.close();
      process.exit(130);
    }, 2000);
  };
  process.on('SIGINT', sigintHandler);

  const spinner = new Spinner(!opts.json && !opts.quiet && !opts.verbose, opts.verbose);
  let agentText = '';
  let reasoningText = '';
  let tokenInfo: CodexEvent | null = null;
  let threadInfo: { threadId: string; model: string } | null = null;
  let turnError: string | undefined;
  let latestDiff = '';
  let receipt: MagicReceipt | null = null;
  let jsonPrinted = false;
  const thinkingEvents: HistoryThinkingEntry[] = [];
  const commandsByItemId = new Map<string, CommandRecord>();
  const commands: CommandRecord[] = [];
  const filesChanged = new Set<string>();
  const toolsUsed = new Set<string>();
  const argvSnapshot = ['magic', ...args];
  const command = `karl ${argvSnapshot.join(' ')}`;

  try {
    await client.start();
    await client.initialize();

    // Start or resume thread
    if (opts.continue) {
      const last = loadLastThread(opts.cwd);
      if (last) {
        threadInfo = await client.resumeThread(last.threadId);
      } else {
        if (!opts.quiet && !opts.json) {
          process.stderr.write(pc.dim('No previous thread — starting new.\n'));
        }
        threadInfo = await client.startThread();
      }
    } else {
      threadInfo = await client.startThread();
    }

    if (opts.persist && threadInfo) {
      saveLastThread(opts.cwd, threadInfo.threadId);
    }

    if (!opts.quiet && !opts.json && threadInfo) {
      process.stderr.write(pc.dim(`using ${threadInfo.model} · reasoning ${formatEffortForDisplay(effort)}\n`));
      process.stderr.write(pc.dim('i\'m on it\n'));
      spinner.start('magic');
    }

    // Run the turn
    let spinnerStopped = false;
    for await (const event of client.startTurn(task)) {
      switch (event.type) {
        case 'agent_message_delta':
          reasoningText = '';
          agentText += event.text;
          if (!opts.quiet && !opts.json) {
            if (!spinnerStopped) {
              spinner.stop();
              spinnerStopped = true;
            }
            process.stdout.write(event.text);
          }
          break;

        case 'reasoning_delta':
          statusWriter?.onThinking(event.text);
          if (event.text.trim()) {
            thinkingEvents.push({ ts: Date.now(), text: event.text });
          }
          if (opts.verbose) {
            process.stderr.write(pc.dim(event.text));
          } else if (!opts.quiet && !opts.json) {
            reasoningText += event.text;
            spinner.setThinking(reasoningText);
          }
          break;

        case 'command_start':
          reasoningText = '';
          toolsUsed.add('bash');
          commandsByItemId.set(event.itemId, {
            command: event.command,
            cwd: event.cwd,
            startedAt: Date.now(),
          });
          commands.push(commandsByItemId.get(event.itemId)!);
          statusWriter?.onToolStart('bash', event.command);
          if (!opts.quiet && !opts.json) {
            const cmd = event.command.length > 60
              ? event.command.slice(0, 57) + '...'
              : event.command;
            spinner.log(`  ${pc.cyan('▸')} ${pc.dim(cmd)}`);
          }
          break;

        case 'command_output_delta':
          if (opts.verbose) {
            process.stderr.write(pc.dim(event.delta));
          }
          break;

        case 'command_end': {
          const ok = event.exitCode === 0 || event.exitCode === null;
          const record = commandsByItemId.get(event.itemId);
          if (record) {
            record.exitCode = event.exitCode;
            record.durationMs = event.durationMs;
          }
          statusWriter?.onToolEnd('bash', ok);
          if (!opts.quiet && !opts.json) {
            const icon = ok ? pc.green('✓') : pc.red('✗');
            const dur = event.durationMs != null
              ? ` ${pc.dim(`${(event.durationMs / 1000).toFixed(1)}s`)}`
              : '';
            spinner.log(`  ${icon} ${pc.dim('done')}${dur}`);
          }
          break;
        }

        case 'file_change':
          toolsUsed.add('patch');
          if (event.filePath) {
            filesChanged.add(event.filePath);
          }
          if (event.status === 'started') {
            statusWriter?.onToolStart('patch', event.filePath);
          } else {
            statusWriter?.onToolEnd('patch', event.status === 'applied');
          }
          if (!opts.quiet && !opts.json) {
            const fname = event.filePath
              ? event.filePath.split('/').pop()
              : null;
            if (event.status === 'started') {
              spinner.log(`  ${pc.cyan('▸')} ${pc.dim('patch')} ${pc.dim(fname ?? '')}`);
            } else {
              const ok = event.status === 'applied';
              const icon = ok ? pc.green('✓') : pc.red('✗');
              spinner.log(`  ${icon} ${pc.dim(fname ?? 'patch')}`);
            }
          }
          break;

        case 'plan_delta':
          statusWriter?.onThinking(event.text);
          if (event.text.trim()) {
            thinkingEvents.push({ ts: Date.now(), text: event.text });
          }
          if (opts.verbose) {
            process.stderr.write(pc.dim(event.text));
          } else if (!opts.quiet && !opts.json) {
            reasoningText += event.text;
            spinner.setThinking(reasoningText);
          }
          break;

        case 'turn_diff':
          latestDiff = event.diff;
          if (opts.verbose && event.diff) {
            process.stderr.write(`\n${pc.dim('─── diff ───')}\n${event.diff}\n`);
          }
          break;

        case 'token_usage':
          tokenInfo = event;
          break;

        case 'error':
          if (!event.willRetry) {
            turnError = event.message;
          }
          if (!spinnerStopped) {
            spinner.stop();
            spinnerStopped = true;
          }
          process.stderr.write(`${pc.red('error:')} ${event.message}`);
          if (event.willRetry) {
            process.stderr.write(pc.dim(' (retrying)'));
          }
          process.stderr.write('\n');
          break;

        case 'turn_completed':
          if (event.error) {
            turnError = event.error;
            process.stderr.write(`${pc.red('turn failed:')} ${event.error}\n`);
          } else if (event.status && event.status !== 'completed') {
            turnError = `turn ${event.status}`;
          }
          break;
      }
    }

    if (!spinnerStopped) {
      spinner.stop();
    }

    const durationMs = Date.now() - runStartedAt;
    if (turnError) {
      process.exitCode = 1;
    }
    receipt = {
      id: historyId,
      status: turnError ? 'error' : 'success',
      cwd: runCwd,
      sourceCwd: worktreeInfo ? sourceCwd : undefined,
      worktree: worktreeInfo?.path,
      threadId: client.threadId,
      model: threadInfo?.model,
      reasoningEffort: effort,
      durationMs,
      commands,
      filesChanged: Array.from(filesChanged),
      tokens: tokenUsageFromEvent(tokenInfo),
      error: turnError,
    };

    // Final output
    if (opts.quiet && agentText) {
      process.stdout.write(agentText);
      if (!agentText.endsWith('\n')) process.stdout.write('\n');
    } else if (opts.json) {
      const result: any = {
        id: historyId,
        status: receipt.status,
        result: agentText,
        threadId: client.threadId,
        model: threadInfo?.model,
        reasoningEffort: effort,
        cwd: runCwd,
        sourceCwd: worktreeInfo ? sourceCwd : undefined,
        worktree: worktreeInfo?.path,
        durationMs,
        receipt,
      };
      if (tokenInfo && tokenInfo.type === 'token_usage') {
        result.tokens = {
          input: tokenInfo.input,
          output: tokenInfo.output,
          cached: tokenInfo.cached,
          reasoning: tokenInfo.reasoning,
          total: tokenInfo.total,
        };
      }
      if (turnError) {
        result.error = turnError;
      }
      console.log(JSON.stringify(result, null, 2));
      jsonPrinted = true;
    } else if (agentText && !agentText.endsWith('\n')) {
      process.stdout.write('\n');
    }

    // Stats
    if (opts.stats && tokenInfo && tokenInfo.type === 'token_usage') {
      const dur = (durationMs / 1000).toFixed(1);
      process.stderr.write(
        pc.dim(`\n${tokenInfo.input} in / ${tokenInfo.output} out / ${tokenInfo.cached} cached / ${tokenInfo.reasoning} reasoning — ${dur}s\n`)
      );
    }
  } catch (e: any) {
    spinner.stop();
    turnError = e?.message ?? String(e);
    console.error(`${pc.red('magic error:')} ${turnError}`);
    process.exitCode = 1;
  } finally {
    const completedAt = Date.now();
    const durationMs = completedAt - runStartedAt;
    if (!receipt) {
      receipt = {
        id: historyId,
        status: turnError ? 'error' : 'success',
        cwd: runCwd,
        sourceCwd: worktreeInfo ? sourceCwd : undefined,
        worktree: worktreeInfo?.path,
        threadId: client.threadId,
        model: threadInfo?.model,
        reasoningEffort: effort,
        durationMs,
        commands,
        filesChanged: Array.from(filesChanged),
        tokens: tokenUsageFromEvent(tokenInfo),
        error: turnError,
      };
    }

    if (opts.json && !jsonPrinted) {
      console.log(JSON.stringify({
        id: historyId,
        status: receipt.status,
        result: agentText,
        threadId: client.threadId,
        model: threadInfo?.model,
        reasoningEffort: effort,
        cwd: runCwd,
        sourceCwd: worktreeInfo ? sourceCwd : undefined,
        worktree: worktreeInfo?.path,
        durationMs,
        receipt,
        error: receipt.error,
      }, null, 2));
      jsonPrinted = true;
    }

    if (receipt.status === 'success') {
      statusWriter?.onComplete(durationMs);
    } else {
      statusWriter?.onError(receipt.error ?? 'Unknown error', durationMs);
    }

    if (history.store) {
      try {
        history.store.insertRun({
          id: historyId,
          createdAt: runStartedAt,
          completedAt,
          durationMs,
          status: receipt.status,
          exitCode: receipt.status === 'success' ? 0 : 1,
          cwd: runCwd,
          command,
          argv: argvSnapshot,
          modelKey: model,
          modelId: threadInfo?.model ?? model,
          providerKey: 'codex',
          providerType: 'codex-app-server',
          skill: 'magic',
          prompt: task,
          response: agentText || undefined,
          error: receipt.error,
          thinking: thinkingEvents,
          contextInline: opts.instructions,
          systemPrompt: effectiveInstructions,
          configSnapshot: {
            magic: {
              threadId: client.threadId,
              reasoningEffort: effort,
              persist: opts.persist,
              continue: opts.continue,
              sourceCwd,
              runCwd,
              receipt: opts.receipt,
              requireClean: opts.requireClean,
              worktree: worktreeInfo
                ? {
                    path: worktreeInfo.path,
                    head: worktreeInfo.head,
                    repoRoot: worktreeInfo.repoRoot,
                    loadedWorktreeNote: !!worktreeInfo.bootstrapNote,
                  }
                : undefined,
              commands,
              filesChanged: Array.from(filesChanged),
            },
          },
          toolsUsed: Array.from(toolsUsed),
          tokens: receipt.tokens,
          diffs: latestDiff ? [truncateDiff(latestDiff, history.config)] : undefined,
          parentId: process.env.KARL_ROUTE_PARENT_ID || undefined,
          tags: ['magic', 'codex'],
        });
      } catch (error) {
        if (!opts.quiet && !opts.json) {
          console.error(`History error: ${(error as Error).message}`);
        }
      }
    }

    if (opts.receipt && !opts.json && receipt) {
      printReceipt(receipt);
    }

    process.removeListener('SIGINT', sigintHandler);
    await client.close();
  }
}
