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
 *   karl magic --effort high     # reasoning effort (default: none)
 *   karl magic --json "task"     # JSON output
 */

import { homedir } from 'os';
import { join } from 'path';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import pc from 'picocolors';
import { Spinner } from '../spinner.js';
import { CodexClient, type CodexEvent } from '../magic-client.js';

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
  task: string | null;
}

const REASONING_EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);
const DEFAULT_REASONING_EFFORT = 'none';

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
      case '-m': case '--model':
        opts.model = args[++i]; break;
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
    console.error('  -m, --model MODEL   Override model');
    console.error('  -j, --json          JSON output');
    console.error('  --cwd PATH          Override working directory');
    console.error('  --instructions STR  Developer instructions');
    console.error('  --schema FILE       JSON Schema for structured output');
    console.error('  --effort LEVEL      Reasoning effort (none/off/minimal/low/medium/high/xhigh)');
    console.error('  --stats             Print token usage');
    process.exitCode = 1;
    return;
  }

  const effort = normalizeEffort(opts.effort);
  if (!REASONING_EFFORTS.has(effort)) {
    console.error(`Invalid --effort value: ${opts.effort}`);
    console.error('Expected one of: none, off, minimal, low, medium, high, xhigh');
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

  const client = new CodexClient({
    cwd: opts.cwd,
    model: opts.model,
    instructions: opts.instructions,
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
  const startTime = Date.now();

  try {
    await client.start();
    await client.initialize();

    // Start or resume thread
    let threadInfo: { threadId: string; model: string };
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

    if (opts.persist) {
      saveLastThread(opts.cwd, threadInfo.threadId);
    }

    if (!opts.quiet && !opts.json) {
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
          if (opts.verbose) {
            process.stderr.write(pc.dim(event.text));
          } else if (!opts.quiet && !opts.json) {
            reasoningText += event.text;
            spinner.setThinking(reasoningText);
          }
          break;

        case 'command_start':
          reasoningText = '';
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
          if (opts.verbose) {
            process.stderr.write(pc.dim(event.text));
          } else if (!opts.quiet && !opts.json) {
            reasoningText += event.text;
            spinner.setThinking(reasoningText);
          }
          break;

        case 'turn_diff':
          if (opts.verbose && event.diff) {
            process.stderr.write(`\n${pc.dim('─── diff ───')}\n${event.diff}\n`);
          }
          break;

        case 'token_usage':
          tokenInfo = event;
          break;

        case 'error':
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
            process.stderr.write(`${pc.red('turn failed:')} ${event.error}\n`);
          }
          break;
      }
    }

    if (!spinnerStopped) {
      spinner.stop();
    }

    // Final output
    if (opts.quiet && agentText) {
      process.stdout.write(agentText);
      if (!agentText.endsWith('\n')) process.stdout.write('\n');
    } else if (opts.json) {
      const result: any = {
        result: agentText,
        threadId: client.threadId,
        model: threadInfo.model,
        reasoningEffort: effort,
        durationMs: Date.now() - startTime,
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
      console.log(JSON.stringify(result, null, 2));
    } else if (agentText && !agentText.endsWith('\n')) {
      process.stdout.write('\n');
    }

    // Stats
    if (opts.stats && tokenInfo && tokenInfo.type === 'token_usage') {
      const dur = ((Date.now() - startTime) / 1000).toFixed(1);
      process.stderr.write(
        pc.dim(`\n${tokenInfo.input} in / ${tokenInfo.output} out / ${tokenInfo.cached} cached / ${tokenInfo.reasoning} reasoning — ${dur}s\n`)
      );
    }
  } catch (e: any) {
    spinner.stop();
    console.error(`${pc.red('magic error:')} ${e.message}`);
    process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', sigintHandler);
    await client.close();
  }
}
