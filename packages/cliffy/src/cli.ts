#!/usr/bin/env bun
import path from 'path';
import { loadConfig, resolveModel, isConfigValid } from './config.js';
import { buildSystemPrompt } from './context.js';
import { HookRunner } from './hooks.js';
import { createTuiRenderer } from './tui.js';
import { initState, applyEvent } from './state.js';
import { VolleyScheduler } from './scheduler.js';
import { runTask } from './runner.js';
import { printResults } from './print.js';
import { CliOptions } from './types.js';
import { formatError, parseDurationMs, readTextIfExists } from './utils.js';
import { getProviderOAuthToken, runLoginFlow } from './oauth.js';
import { Spinner } from './spinner.js';
import { loadStack } from './stacks.js';

async function printHelp(): Promise<void> {
  const help = `cliffy [flags] <task> [task...]
cliffy as <stack> <task> [task...]

Flags:
  --fast, -f           Use the fast model
  --smart, -s          Use the smart model
  --model, -m          Exact model id or alias
  --tui                 Enable live TUI (default: off)
  --verbose, -v        Stream thoughts and tool calls as a log
  --json, -j           JSON output
  --stats              Print summary stats
  --max-concurrent     Max parallel tasks (default: 3)
  --timeout            Per-task timeout (e.g. 30s, 5000ms)
  --skill              Load a skill by name
  --no-tools           Disable tool use
  --unrestricted       Allow writes outside working directory
  --context            Extra system prompt text
  --context-file       Path to extra system prompt file
  --tasks-file         Path to a tasks file (one per line)
  -                    Read a task from stdin
  --login              OAuth login (Claude Pro/Max)
  --logout             Clear OAuth credentials
  --dry-run            Show config without running
  --help, -h           Show help
  --version            Show version

Config Stacks:
  cliffy as <stack> <task>        Run with a named config stack
  cliffy stacks list              List available stacks
  cliffy stacks show <name>       Show stack details
  cliffy stacks create <name>     Create a new stack

Skills Commands:
  cliffy skills list              List available skills
  cliffy skills show <name>       Show skill details
  cliffy skills create <name>     Create a new skill template
  cliffy skills validate <path>   Validate a skill

Setup & Info:
  cliffy init                     Set up a provider and default model
  cliffy setup                    Open the config TUI
  cliffy info                     Show system info (add --json for JSON output)

Examples:
  cliffy "fix the bug in parser.go"
  cliffy as codex52-architect "review spec and create implementation plan"
  cliffy as trivia-expert "circumference of earth in miles"
  cliffy --skill security-review "analyze this codebase"
  cliffy --fast "what does this function do?" "test the auth flow"
  cliffy setup
  cliffy stacks list
  cliffy skills list
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
      case '--unrestricted':
        options.unrestricted = true;
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
      case '--dry-run':
        options.dryRun = true;
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
  let args = process.argv.slice(2);

  // Handle setup command - launches the config TUI
  if (args[0] === 'setup') {
    const { spawnSync } = await import('child_process');
    const result = spawnSync('cliffy-tui', [], { stdio: 'inherit' });
    if (result.error) {
      // Try cargo run as fallback for development
      const cargoResult = spawnSync('cargo', ['run', '--manifest-path', 'packages/cliffy-tui/Cargo.toml'], { stdio: 'inherit' });
      if (cargoResult.error) {
        console.error('Could not launch config TUI. Install cliffy-tui or run from repo root.');
        process.exitCode = 1;
      }
    }
    return;
  }

  // Handle init command - launches the init wizard
  if (args[0] === 'init') {
    const { spawnSync } = await import('child_process');
    const result = spawnSync('cliffy-tui', ['--init'], { stdio: 'inherit' });
    if (result.error) {
      // Try cargo run as fallback for development
      const cargoResult = spawnSync('cargo', ['run', '--manifest-path', 'packages/cliffy-tui/Cargo.toml', '--', '--init'], { stdio: 'inherit' });
      if (cargoResult.error) {
        console.error('Could not launch init wizard. Install cliffy-tui or run from repo root.');
        process.exitCode = 1;
      }
    }
    return;
  }

  // Handle skills commands
  if (args[0] === 'skills') {
    const { handleSkillsCommand } = await import('./commands/skills.js');
    await handleSkillsCommand(args.slice(1));
    return;
  }

  // Handle stacks commands
  if (args[0] === 'stacks') {
    const { handleStacksCommand } = await import('./commands/stacks.js');
    await handleStacksCommand(args.slice(1));
    return;
  }

  // Handle info command - outputs system info as JSON for TUI
  if (args[0] === 'info') {
    const { handleInfoCommand } = await import('./commands/info.js');
    await handleInfoCommand(args.slice(1));
    return;
  }

  // Handle "as <stack>" syntax: cliffy as trivia-expert "question"
  let stackName: string | undefined;
  if (args[0] === 'as' && args.length >= 2) {
    stackName = args[1];
    args = args.slice(2);  // Remove "as" and stack name, keep rest
  }

  const { options, tasks: rawTasks, wantsHelp, wantsVersion, wantsLogin, wantsLogout } = parseArgs(args);

  // Set stack name in options if provided via "as" syntax
  if (stackName) {
    options.stack = stackName;
  }

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
  let config = await loadConfig(cwd);

  // Auto-init: if no valid provider+model, launch the init wizard
  if (!isConfigValid(config)) {
    console.log('No configured provider found. Launching setup wizard...\n');
    const { spawnSync } = await import('child_process');
    const result = spawnSync('cliffy-tui', ['--init'], { stdio: 'inherit' });
    if (result.error) {
      // Try cargo run as fallback for development
      const cargoResult = spawnSync('cargo', ['run', '--manifest-path', 'packages/cliffy-tui/Cargo.toml', '--', '--init'], { stdio: 'inherit' });
      if (cargoResult.error) {
        console.error('Could not launch init wizard. Run `cliffy init` to set up.');
        process.exitCode = 1;
        return;
      }
    }
    // Reload config after wizard completes
    config = await loadConfig(cwd);
    if (!isConfigValid(config)) {
      console.error('Setup incomplete. Run `cliffy init` to configure a provider.');
      process.exitCode = 1;
      return;
    }
  }

  // Load and merge stack config if specified
  let effectiveOptions = options;
  if (options.stack) {
    try {
      effectiveOptions = await loadStack(options.stack, config, options);
    } catch (error) {
      console.error(`Failed to load stack "${options.stack}": ${(error as Error).message}`);
      process.exitCode = 1;
      return;
    }
  }

  const resolvedModel = resolveModel(config, effectiveOptions);

  // Resolve credentials based on provider's authType
  let apiKey: string | null | undefined;

  if (resolvedModel.providerConfig.authType === 'oauth') {
    // OAuth-based provider - fetch token automatically
    apiKey = await getProviderOAuthToken(resolvedModel.providerKey);
  } else {
    // API key based provider (default)
    apiKey = resolvedModel.providerConfig.apiKey;
  }

  // Check if credentials are missing or unexpanded
  if (!apiKey || apiKey.includes('${')) {
    console.error(`No credentials found for provider: ${resolvedModel.providerKey}`);
    console.error('');
    if (resolvedModel.providerConfig.authType === 'oauth') {
      console.error('Run `cliffy --login` to authenticate.');
    } else {
      console.error(`Set the appropriate API key environment variable.`);
    }
    process.exitCode = 1;
    return;
  }
  
  const hooks = await HookRunner.load(cwd);

  const tasksFromFile = effectiveOptions.tasksFile ? await readTasksFile(effectiveOptions.tasksFile, cwd) : [];
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

  if (effectiveOptions.maxConcurrent !== undefined && (!Number.isFinite(effectiveOptions.maxConcurrent) || effectiveOptions.maxConcurrent < 1)) {
    throw new Error('Invalid --max-concurrent value.');
  }

  // Dry run: show config without running
  if (effectiveOptions.dryRun) {
    console.log('Dry Run Configuration\n');
    console.log(`Provider:     ${resolvedModel.providerKey}`);
    console.log(`Model:        ${resolvedModel.model}`);
    console.log(`Model Alias:  ${resolvedModel.modelKey}`);
    console.log(`Auth:         ${resolvedModel.providerConfig.authType === 'oauth' ? 'OAuth' : 'API Key'}`);
    if (effectiveOptions.skill) {
      console.log(`Skill:        ${effectiveOptions.skill}`);
    }
    if (options.stack) {
      console.log(`Stack:        ${options.stack}`);
    }
    console.log(`Tools:        ${effectiveOptions.noTools ? 'disabled' : config.tools.enabled.join(', ')}`);
    console.log(`Tasks:        ${finalTasks.length}`);
    for (const task of finalTasks) {
      console.log(`  - "${task.length > 60 ? task.slice(0, 60) + '...' : task}"`);
    }
    return;
  }

  const systemPrompt = await buildSystemPrompt({
    cwd,
    skill: effectiveOptions.skill,
    context: effectiveOptions.context,
    contextFile: effectiveOptions.contextFile,
    unrestricted: effectiveOptions.unrestricted
  });

  const state = initState(finalTasks);
  const useTui = effectiveOptions.tui ?? false;
  const tui = await createTuiRenderer(useTui);
  const useVerbose = effectiveOptions.verbose && !useTui && !effectiveOptions.json;
  const spinner = new Spinner(!useTui && !effectiveOptions.json, useVerbose);

  if (useTui) {
    tui.update(state);
  }

  const scheduler = new VolleyScheduler(
    {
      maxConcurrent: effectiveOptions.maxConcurrent ?? config.volley.maxConcurrent,
      retryAttempts: config.volley.retryAttempts,
      retryBackoff: config.volley.retryBackoff,
      timeoutMs: effectiveOptions.timeoutMs
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
        noTools: effectiveOptions.noTools,
        unrestricted: effectiveOptions.unrestricted,
        timeoutMs: effectiveOptions.timeoutMs,
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
      json: effectiveOptions.json,
      verbose: effectiveOptions.verbose,
      stats: effectiveOptions.stats
    });
  }
}

main().catch((error) => {
  console.error(formatError(error));
  process.exitCode = 1;
});
