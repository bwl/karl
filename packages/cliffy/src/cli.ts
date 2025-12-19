#!/usr/bin/env bun
import path from 'path';
import { loadConfig, resolveModel } from './config.js';
import { buildSystemPrompt } from './context.js';
import { HookRunner } from './hooks.js';
import { createTuiRenderer } from './tui.js';
import { initState, applyEvent } from './state.js';
import { VolleyScheduler } from './scheduler.js';
import { runTask } from './runner.js';
import { printResults } from './print.js';
import { CliOptions } from './types.js';
import { formatError, parseDurationMs, readTextIfExists } from './utils.js';
import { getAnthropicAccessToken, runLoginFlow } from './oauth.js';
import { Spinner } from './spinner.js';

async function printHelp(): Promise<void> {
  const help = `cliffy [flags] <task> [task...]

Flags:
  --fast, -f           Use the fast model
  --smart, -s          Use the smart model
  --model, -m          Exact model id or alias
  --tui                 Enable live TUI (default: off)
  --verbose, -v        Print tool traces and timing
  --json, -j           JSON output
  --stats              Print summary stats
  --max-concurrent     Max parallel tasks (default: 3)
  --timeout            Per-task timeout (e.g. 30s, 5000ms)
  --skill              Load a skill by name
  --no-tools           Disable tool use
  --context            Extra system prompt text
  --context-file       Path to extra system prompt file
  --tasks-file         Path to a tasks file (one per line)
  -                    Read a task from stdin
  --login              OAuth login (Claude Pro/Max)
  --logout             Clear OAuth credentials
  --help, -h           Show help
  --version            Show version
`;
  console.log(help);
}

async function readStdin(): Promise<string> {
  return await new Response(process.stdin).text();
}

async function readTasksFile(filePath: string, cwd: string): Promise<string[]> {
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
  const content = await readTextIfExists(resolved);
  if (content === null) {
    throw new Error(`Tasks file not found: ${resolved}`);
  }
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseArgs(argv: string[]): { options: CliOptions; tasks: (string | null)[]; wantsHelp: boolean; wantsVersion: boolean; wantsLogin: boolean; wantsLogout: boolean } {
  const options: CliOptions = {};
  const tasks: (string | null)[] = [];
  let wantsHelp = false;
  let wantsVersion = false;
  let wantsLogin = false;
  let wantsLogout = false;
  const requireValue = (name: string, value: string | undefined): string => {
    if (!value) {
      throw new Error(`Missing value for ${name}`);
    }
    return value;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') {
      tasks.push(...argv.slice(i + 1));
      break;
    }
    const [flag, inlineValue] = arg.startsWith('--') && arg.includes('=') ? arg.split(/=(.+)/) : [arg, undefined];

    switch (flag) {
      case '--help':
      case '-h':
        wantsHelp = true;
        break;
      case '--version':
        wantsVersion = true;
        break;
      case '--fast':
      case '-f':
        options.fast = true;
        break;
      case '--smart':
      case '-s':
        options.smart = true;
        break;
      case '--model':
      case '-m':
        options.model = requireValue(flag, inlineValue ?? argv[++i]);
        break;
      case '--tui':
        options.tui = true;
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--json':
      case '-j':
        options.json = true;
        break;
      case '--stats':
        options.stats = true;
        break;
      case '--max-concurrent':
        options.maxConcurrent = Number(requireValue(flag, inlineValue ?? argv[++i]));
        break;
      case '--timeout': {
        const raw = requireValue(flag, inlineValue ?? argv[++i]);
        const parsed = raw ? parseDurationMs(raw) : null;
        if (!parsed) {
          throw new Error(`Invalid timeout: ${raw}`);
        }
        options.timeoutMs = parsed;
        break;
      }
      case '--skill':
        options.skill = requireValue(flag, inlineValue ?? argv[++i]);
        break;
      case '--no-tools':
        options.noTools = true;
        break;
      case '--context':
        options.context = requireValue(flag, inlineValue ?? argv[++i]);
        break;
      case '--context-file':
        options.contextFile = requireValue(flag, inlineValue ?? argv[++i]);
        break;
      case '--tasks-file':
        options.tasksFile = requireValue(flag, inlineValue ?? argv[++i]);
        break;
      case '--login':
        wantsLogin = true;
        break;
      case '--logout':
        wantsLogout = true;
        break;
      case '-':
        tasks.push(null);
        break;
      default:
        if (arg.startsWith('-')) {
          throw new Error(`Unknown flag: ${arg}`);
        }
        tasks.push(arg);
        break;
    }
  }

  return { options, tasks, wantsHelp, wantsVersion, wantsLogin, wantsLogout };
}

async function loadVersion(): Promise<string> {
  const pkgPath = new URL('../package.json', import.meta.url);
  const content = await Bun.file(pkgPath).text();
  const pkg = JSON.parse(content) as { version?: string };
  return pkg.version ?? '0.0.0';
}

async function main() {
  const { options, tasks: rawTasks, wantsHelp, wantsVersion, wantsLogin, wantsLogout } = parseArgs(process.argv.slice(2));

  if (wantsHelp) {
    await printHelp();
    return;
  }

  if (wantsVersion) {
    console.log(await loadVersion());
    return;
  }

  if (wantsLogin) {
    await runLoginFlow();
    return;
  }

  if (wantsLogout) {
    const { removeOAuthCredentials } = await import('./oauth.js');
    removeOAuthCredentials('anthropic');
    console.log('OAuth credentials cleared.');
    return;
  }

  const cwd = process.cwd();
  const config = await loadConfig(cwd);
  const resolvedModel = resolveModel(config, options);
  
  // Try to get API key: env var first, then OAuth
  let apiKey = resolvedModel.providerConfig.apiKey;
  
  // Check if API key is missing or unexpanded (still contains ${...})
  const apiKeyMissing = !apiKey || apiKey.includes('${');
  
  if (apiKeyMissing && resolvedModel.providerKey === 'anthropic') {
    apiKey = await getAnthropicAccessToken();
  }
  
  if (!apiKey || apiKey.includes('${')) {
    console.error(`No API key found for provider: ${resolvedModel.providerKey}`);
    console.error('');
    if (resolvedModel.providerKey === 'anthropic') {
      console.error('Run `cliffy --login` to authenticate with Claude Pro/Max,');
      console.error('or set ANTHROPIC_API_KEY environment variable.');
    } else {
      console.error(`Set the appropriate API key environment variable.`);
    }
    process.exitCode = 1;
    return;
  }
  
  const hooks = await HookRunner.load(cwd);

  const tasksFromFile = options.tasksFile ? await readTasksFile(options.tasksFile, cwd) : [];
  const tasks: (string | null)[] = [...rawTasks, ...tasksFromFile];

  const needsStdin = tasks.some((task) => task === null) || (tasks.length === 0 && !process.stdin.isTTY);
  let stdinTask: string | null = null;
  if (needsStdin) {
    stdinTask = (await readStdin()).trim();
  }

  const finalTasks: string[] = [];
  for (const task of tasks) {
    if (task === null) {
      if (stdinTask) {
        finalTasks.push(stdinTask);
      }
      continue;
    }
    finalTasks.push(task);
  }

  if (finalTasks.length === 0) {
    throw new Error('No tasks provided.');
  }

  if (options.maxConcurrent !== undefined && (!Number.isFinite(options.maxConcurrent) || options.maxConcurrent < 1)) {
    throw new Error('Invalid --max-concurrent value.');
  }

  const systemPrompt = await buildSystemPrompt({
    cwd,
    skill: options.skill,
    context: options.context,
    contextFile: options.contextFile
  });

  const state = initState(finalTasks);
  const useTui = options.tui ?? false;
  const tui = await createTuiRenderer(useTui);
  const spinner = new Spinner(!useTui && !options.json);
  
  if (useTui) {
    tui.update(state);
  }

  const scheduler = new VolleyScheduler(
    {
      maxConcurrent: options.maxConcurrent ?? config.volley.maxConcurrent,
      retryAttempts: config.volley.retryAttempts,
      retryBackoff: config.volley.retryBackoff,
      timeoutMs: options.timeoutMs
    },
    (event) => {
      applyEvent(state, event);
      if (useTui) {
        tui.update(state);
      }
    }
  );

  let results: Awaited<ReturnType<typeof scheduler.run>> | null = null;
  try {
    // Show spinner for single tasks in non-TUI mode
    if (!useTui && finalTasks.length === 1) {
      spinner.start('');  // Uses default "cliffy is on it..."
    } else if (!useTui && finalTasks.length > 1) {
      spinner.start(`volleying ${finalTasks.length} tasks...`);
    }

    results = await scheduler.run(finalTasks, (task, index, attempt) =>
      runTask({
        task,
        index,
        attempt,
        cwd,
        model: resolvedModel.model,
        providerKey: resolvedModel.providerKey,
        apiKey,
        systemPrompt,
        hooks,
        toolsConfig: config.tools,
        noTools: options.noTools,
        timeoutMs: options.timeoutMs,
        onEvent: (event) => {
          applyEvent(state, event);
          if (useTui) {
            tui.update(state);
          } else if (event.type === 'thinking') {
            spinner.setThinking(event.text);
          } else if (event.type === 'tool_start') {
            spinner.toolStart(event.tool, event.detail);
          } else if (event.type === 'tool_end') {
            spinner.toolEnd(event.tool, event.success);
          } else if (event.type === 'task_complete' && finalTasks.length > 1) {
            const done = state.tasks.filter(t => t.status === 'done' || t.status === 'error').length;
            spinner.update(`${done}/${finalTasks.length} tasks...`);
          }
        }
      })
    );
  } finally {
    spinner.stop();
    tui.close();
  }

  if (results) {
    printResults(results, {
      json: options.json,
      verbose: options.verbose,
      stats: options.stats
    });
  }
}

main().catch((error) => {
  console.error(formatError(error));
  process.exitCode = 1;
});
