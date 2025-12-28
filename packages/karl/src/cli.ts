#!/usr/bin/env bun
import path from 'path';
import { loadConfig, resolveModel, isConfigValid } from './config.js';
import { buildSystemPrompt } from './context.js';
import { HookRunner } from './hooks.js';
import { initState, applyEvent } from './state.js';
import { runTask } from './runner.js';
import { printResults } from './print.js';
import { StatusWriter } from './status.js';
import { type CliOptions, type RetryConfig, type SchedulerEvent, type TaskResult, type ToolDiff } from './types.js';
import { formatError, parseDurationMs, readTextIfExists, resolveHomePath, sleep } from './utils.js';
import { getProviderOAuthToken } from './oauth.js';
import { Spinner } from './spinner.js';
import { loadStack, StackManager } from './stacks.js';
import { SkillManager } from './skills.js';
import { createInterface } from 'readline';
import { TaskRunError } from './errors.js';
import { buildHistoryId, createHistoryStore, type HistoryThinkingEntry } from './history.js';

/**
 * Built-in commands that are handled specially.
 * Everything else is either a stack-as-verb or an error.
 */
const BUILTIN_COMMANDS = new Set([
  // Core commands
  'run',       // Run task using 'default' stack
  'ask',       // Alias for run
  'do',        // Alias for run
  'execute',   // Alias for run
  'exec',      // Alias for run
  'continue',  // Run with --continue (chains from last run)
  'cont',      // Alias for continue
  'followup',  // Alias for continue
  'follow-up', // Alias for continue
  'chain',     // Alias for continue
  // Management commands
  'init',      // First-run setup wizard
  'setup',     // Alias for init
  'providers', // Provider management
  'models',    // Model management
  'stacks',    // Stack management
  'skills',    // Skill management
  'config',    // Config TUI/JSON
  'info',      // System info
  'status',    // Alias for info
  'history',   // Run history
  'logs',      // Alias for history (or job logs)
  'jobs',      // List background jobs
  'previous',  // Last response shortcut
  'prev',      // Alias for previous
  'last',      // Alias for previous
  'tldr',      // Quick reference primer
  'help',      // Alias for tldr
  'agent',     // Interactive orchestrator REPL
  'claude',    // Launch Claude Code with Karl-only tools
  'debugdesign', // UI simulation for design work
  'dd',        // Alias for debugdesign
  'completions', // Shell completion scripts
  'serve',     // JSON-RPC server for IPC with other tools
]);

/**
 * Check if a stack exists by name
 */
async function stackExists(name: string): Promise<boolean> {
  const cwd = process.cwd();
  const config = await loadConfig(cwd);
  const manager = new StackManager(config);
  const stack = await manager.getStack(name);
  return stack !== null;
}

/**
 * Prompt user with a yes/no question
 */
async function promptYesNo(question: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      const normalized = answer.toLowerCase().trim();
      resolve(normalized === 'y' || normalized === 'yes' || normalized === '');
    });
  });
}

/**
 * Interactive wizard for creating a new stack from an unknown command
 */
async function runStackCreationWizard(name: string, originalArgs: string[]): Promise<void> {
  console.log(`\n✨ Let's create the "${name}" command!\n`);

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = (question: string): Promise<string> =>
    new Promise((resolve) => {
      rl.question(question, (answer) => resolve(answer.trim()));
    });

  try {
    // Load config to get available models
    const cwd = process.cwd();
    const config = await loadConfig(cwd);
    const availableModels = Object.keys(config.models || {});

    // Ask for model preference
    let model: string;
    if (availableModels.length > 0) {
      console.log('Available models:');
      availableModels.forEach((m, i) => {
        const modelConfig = config.models[m];
        const isDefault = m === config.defaultModel;
        console.log(`  ${i + 1}. ${m}${isDefault ? ' (default)' : ''} → ${modelConfig.provider}/${modelConfig.model}`);
      });
      console.log('');

      const modelInput = await prompt(`Model [${config.defaultModel}]: `) || config.defaultModel;
      // Allow number selection or name
      const modelIndex = parseInt(modelInput, 10);
      if (!isNaN(modelIndex) && modelIndex >= 1 && modelIndex <= availableModels.length) {
        model = availableModels[modelIndex - 1];
      } else {
        model = modelInput;
      }
    } else {
      console.log('No models configured. Run "karl init" to set up a provider first.');
      rl.close();
      return;
    }

    // Ask for skill
    const skillManager = new SkillManager();
    const availableSkills = await skillManager.loadAvailableSkills();
    const skillNames = Array.from(availableSkills.keys());

    let skill = '';
    if (skillNames.length > 0) {
      console.log('\nAvailable skills:');
      skillNames.forEach((s, i) => {
        const skillData = availableSkills.get(s)!;
        const desc = skillData.metadata.description?.slice(0, 50) || '';
        console.log(`  ${i + 1}. ${s}${desc ? ` - ${desc}${skillData.metadata.description && skillData.metadata.description.length > 50 ? '...' : ''}` : ''}`);
      });
      console.log('  0. (none)');
      console.log('');

      const skillInput = await prompt('Skill [0]: ') || '0';
      const skillIndex = parseInt(skillInput, 10);
      if (skillIndex >= 1 && skillIndex <= skillNames.length) {
        skill = skillNames[skillIndex - 1];
      } else if (skillInput !== '0' && skillInput !== '') {
        // Allow typing a skill name directly
        skill = skillInput;
      }
    } else {
      console.log('\nNo skills found. You can create skills with "karl skills create <name>".');
      console.log('Skipping skill selection.');
    }

    // Ask for context/system prompt
    console.log('\nContext is added to the system prompt for every run.');
    console.log('Example: "You are an expert code reviewer. Be thorough but concise."');
    const context = await prompt('Context (optional): ');

    // Ask for location
    console.log('\nWhere to save this stack?');
    console.log('  1. global  - Available everywhere (~/.config/karl/stacks/)');
    console.log('  2. project - Only in this directory (./.karl/stacks/)');
    const locationInput = await prompt('Location [1]: ') || '1';
    const isGlobal = locationInput !== '2' && locationInput.toLowerCase() !== 'project';

    rl.close();

    // Create the stack
    const { createStack } = await import('./commands/stacks.js');
    await createStack(name, {
      model,
      skill: skill || undefined,
      global: isGlobal,
    });

    // If context was provided, we need to update the file
    if (context) {
      const { join } = await import('path');
      const { homedir } = await import('os');
      const { readFileSync, writeFileSync } = await import('fs');

      const stacksDir = isGlobal
        ? join(homedir(), '.config', 'karl', 'stacks')
        : join(process.cwd(), '.karl', 'stacks');
      const stackPath = join(stacksDir, `${name}.json`);

      const existing = JSON.parse(readFileSync(stackPath, 'utf-8'));
      existing.context = context;
      writeFileSync(stackPath, JSON.stringify(existing, null, 2) + '\n');
    }

    // Offer to run the original command
    if (originalArgs.length > 0) {
      console.log('');
      const shouldRun = await promptYesNo(`Run "karl ${name} ${originalArgs.join(' ')}" now? [Y/n] `);
      if (shouldRun) {
        // Re-run with the new stack
        const newArgs = [name, ...originalArgs];
        process.argv = ['node', 'karl', ...newArgs];
        await main();
      }
    } else {
      console.log(`\nYou can now use: karl ${name} "your task"`);
    }
  } catch (error) {
    rl.close();
    throw error;
  }
}

async function printOverview(): Promise<void> {
  const overview = `karl run <task>
karl <stack> <task>         (stack as verb)
karl continue <task>        (chain from last run)

Commands:
  run <task>                Run a single task (aliases: ask, do, exec)
  continue <task>           Chain from last run (aliases: cont, followup, chain)
  init                      First-time setup (alias: setup)
  providers                 Manage providers
  models                    Manage models
  stacks                    Manage config stacks
  skills                    Manage agent skills
  config                    Config TUI and JSON views
  info                      Show system info
  history                   Show run history
  jobs                      List background jobs
  previous                  Print last response (aliases: prev, last)
  agent                     Interactive orchestrator (runs karl commands)
  claude                    Launch Claude Code with Karl-only access

Flags:
  --help, -h           Show full help
  --version            Show version

Use "karl --help" for full help, including run flags and subcommands.
`;
  console.log(overview);
}

async function printHelp(): Promise<void> {
  // Get available stacks to show as verbs
  let stackVerbs = '';
  try {
    const cwd = process.cwd();
    const config = await loadConfig(cwd);
    const manager = new StackManager(config);
    const stacks = await manager.listStacks();
    if (stacks.length > 0) {
      const displayStacks = stacks.slice(0, 5);
      stackVerbs = `\nYour Commands (stacks as verbs):\n`;
      for (const stack of displayStacks) {
        let suffix = '';
        if (stack.model) {
          const modelConfig = config.models[stack.model];
          if (modelConfig) {
            suffix = `  ${stack.model}::${modelConfig.provider}/${modelConfig.model}`;
          } else {
            suffix = `  ${stack.model}`;
          }
        }
        stackVerbs += `  karl ${stack.name} <task>${suffix}\n`;
      }
      if (stacks.length > 5) {
        stackVerbs += `  ... and ${stacks.length - 5} more (karl stacks list)\n`;
      }
    }
  } catch {
    // Ignore errors loading stacks for help
  }

  const help = `karl run <task>
karl <stack> <task>         (stack as verb)
karl continue <task>        (chain from last run)

Built-in Commands:
  run <task>                Run a task (aliases: ask, do, exec)
  continue <task>           Chain from last run (aliases: cont, followup, chain)
  init                      First-time setup (alias: setup)
  providers                 Manage providers (add, login, logout)
  models                    Manage models (add, remove, list)
  stacks                    Manage config stacks
  skills                    Manage agent skills
  config                    Config TUI and JSON views
  info                      Show system info (alias: status)
  history                   Show run history (alias: logs)
  previous                  Print last response (aliases: prev, last)
  agent                     Interactive orchestrator (runs karl commands)
  claude                    Launch Claude Code with Karl-only access
${stackVerbs}
Flags (use with 'run'):
  --model, -m          Model alias or exact model id
  --verbose, -v        Stream thoughts and tool calls (aliases: --stream, --progress)
  --json, -j           JSON output
  --stats              Print summary stats
  --timeout            Per-task timeout (e.g. 30s, 5000ms)
  --skill              Load a skill by name
  --no-tools           Disable tool use (aliases: --pure, --reasoning)
  --unrestricted       Allow writes outside working directory
  --context            Extra system prompt text
  --context-file       Path to context file (use - for stdin)
  --continue, -c       Chain from last run (injects previous response as context)
  --parent             Parent run id or reference (@last, @-2) - injects response as context
  --follow-up          Alias for --parent
  --tag                Tag this run (repeatable)
  --no-history         Disable history logging for this run
  --background, -bg    Run in background, return job ID immediately
  -                    Read task from stdin
  --dry-run            Show config without running
  --help, -h           Show help
  --version            Show version

Jobs Commands:
  karl jobs                   List background jobs
  karl jobs clean             Cleanup old completed jobs
  karl status <job-id>        Show job progress
  karl logs <job-id>          Show job output
  karl logs <job-id> --tail   Follow job output

Providers Commands:
  karl providers list           List configured providers
  karl providers add [name]     Add a new provider
  karl providers remove <name>  Remove a provider
  karl providers edit <name>    Edit a provider file
  karl providers login [name]   Login to OAuth provider
  karl providers logout <name>  Logout from OAuth provider

Models Commands:
  karl models list              List configured models
  karl models add [alias]       Add a new model (interactive)
  karl models remove <alias>    Remove a model
  karl models edit <alias>      Edit a model file
  karl models default <alias>   Set the default model

Config Commands:
  karl config                   Launch the config TUI
  karl config show              Show merged config JSON
  karl config edit              Edit config in $EDITOR
  karl config set               Update config fields

Stacks Commands:
  karl stacks list              List available stacks
  karl stacks show <name>       Show stack details
  karl stacks create <name>     Create a new stack
  karl stacks edit <name>       Edit a stack in $EDITOR
  karl stacks set <name>        Update stack fields
  karl stacks remove <name>     Remove a stack (not 'default')

Skills Commands:
  karl skills list              List available skills
  karl skills show <name>       Show skill details
  karl skills create <name>     Create a new skill template
  karl skills validate <path>   Validate a skill

Examples:
  karl run "fix the bug in parser.go"
  karl run --model smart "explain this code"
  karl review "check auth.ts"              (if 'review' stack exists)
  karl commit                              (if 'commit' stack exists)
  karl quickly "2+2"                       (creates 'quickly' stack if missing)
`;
  console.log(help);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
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
      case '--model':
      case '-m':
        options.model = requireValue(flag, inlineValue ?? argv[++i]);
        break;
      case '--verbose':
      case '-v':
      case '--stream':
      case '--progress':
        options.verbose = true;
        break;
      case '--json':
      case '-j':
        options.json = true;
        break;
      case '--stats':
        options.stats = true;
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
      case '--notools':
      case '--pure':
      case '--reasoning':
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
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--parent':
      case '--follow-up':
      case '--followup':
      case '--chain':
        options.parent = requireValue(flag, inlineValue ?? argv[++i]);
        break;
      case '--continue':
      case '-c':
        // Shorthand for --parent @last
        options.parent = '@last';
        break;
      case '--tag': {
        const tag = requireValue(flag, inlineValue ?? argv[++i]);
        if (!options.tags) {
          options.tags = [];
        }
        options.tags.push(tag);
        break;
      }
      case '--no-history':
        options.noHistory = true;
        break;
      case '--show-history':
        options.showHistoryId = true;
        break;
      case '--plain':
        options.plain = true;
        break;
      case '--visuals':
        options.visuals = requireValue(flag, inlineValue ?? argv[++i]);
        break;
      case '--background':
      case '-bg':
      case '--bg':
      case '--detach':
        options.background = true;
        break;
      case '--stack':
        options.stack = requireValue(flag, inlineValue ?? argv[++i]);
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

  if (tasks.length > 1) {
    throw new Error(`Multiple tasks provided. Karl accepts a single task per run.`);
  }

  return { options, tasks, wantsHelp, wantsVersion, wantsLogin, wantsLogout };
}

function isRetryable(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const anyError = error as { retryable?: boolean; status?: number; code?: number };
    if (anyError.retryable) {
      return true;
    }
    const status = anyError.status ?? anyError.code;
    if (status && [408, 429, 500, 502, 503, 504].includes(status)) {
      return true;
    }
  }
  const message = formatError(error).toLowerCase();
  return message.includes('rate limit') || message.includes('timeout') || message.includes('temporar');
}

function backoffMs(attempt: number, strategy: 'exponential' | 'linear'): number {
  if (strategy === 'linear') {
    return Math.min(60_000, attempt * 1_000);
  }
  return Math.min(60_000, 1_000 * Math.pow(2, attempt - 1));
}

async function runTaskWithRetry(
  task: string,
  runner: (attempt: number) => ReturnType<typeof runTask>,
  retryConfig: RetryConfig,
  onEvent?: (event: SchedulerEvent) => void
): Promise<TaskResult> {
  let attempt = 0;
  while (true) {
    const attemptStart = Date.now();
    try {
      return await runner(attempt);
    } catch (error) {
      const retryable = isRetryable(error);
      if (retryable && attempt < retryConfig.attempts) {
        const delayMs = backoffMs(attempt + 1, retryConfig.backoff);
        onEvent?.({
          type: 'task_retry',
          taskIndex: 0,
          task,
          time: Date.now(),
          attempt: attempt + 1,
          delayMs,
          error: formatError(error)
        });
        await sleep(delayMs);
        attempt += 1;
        continue;
      }
      const message = formatError(error);
      const errorData = error as TaskRunError;
      const durationMs = errorData.durationMs ?? Date.now() - attemptStart;
      return {
        task,
        status: 'error',
        error: message,
        durationMs,
        toolsUsed: errorData.toolsUsed ?? [],
        tokens: errorData.tokens
      };
    }
  }
}

async function loadVersion(): Promise<string> {
  const pkgPath = new URL('../package.json', import.meta.url);
  const content = await Bun.file(pkgPath).text();
  const pkg = JSON.parse(content) as { version?: string };
  return pkg.version ?? '0.0.0';
}

async function main() {
  let args = process.argv.slice(2);
  const firstArg = args[0];

  // Handle --help and --version at top level (before command dispatch)
  if (firstArg === '--help' || firstArg === '-h') {
    await printHelp();
    return;
  }
  if (firstArg === '--version') {
    console.log(await loadVersion());
    return;
  }

  // Easter egg: karl boo (like ghostty ++boo)
  if (firstArg === 'boo' || firstArg === '++boo') {
    console.log(`
                       o
                      /|\\
                     / | \\
                       |
       ╦╔═ ╔═╗ ╦═╗ ╦        .    *    .
       ╠╩╗ ╠═╣ ╠╦╝ ║      *   \\o/   *
       ╩ ╩ ╩ ╩ ╩╚═ ╩═╝        |
           ┌────────────────/ \\───────┐
           │    ═══════════════════   │
           │   │   │   │   │   │   │  │
           │   │   │   │   │   │   │  │
           │   │   │   │   │   │   │  │
           │   │   │   │   │   │   │  │
           │   │   │   │   │   │   │  │
           └───┴───┴───┴───┴───┴───┴──┘
                  🎾 GAME ON 🎾
`);
    return;
  }

  // No args = show help
  if (!firstArg) {
    await printOverview();
    return;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // COMMAND DISPATCH
  // ─────────────────────────────────────────────────────────────────────────

  // Handle 'run' command - uses 'default' stack
  if (firstArg === 'run' || firstArg === 'ask' || firstArg === 'do' || firstArg === 'execute' || firstArg === 'exec') {
    args = args.slice(1);  // Remove 'run', rest are flags + tasks
    // Always use 'default' stack (unless --stack is explicitly specified)
    if (!args.includes('--stack')) {
      args = ['--stack', 'default', ...args];
    }
  }
  // Handle 'continue' / 'followup' / 'chain' commands - run with --continue
  else if (firstArg === 'continue' || firstArg === 'cont' || firstArg === 'followup' || firstArg === 'follow-up' || firstArg === 'chain') {
    args = args.slice(1);
    args = ['--stack', 'default', '--continue', ...args];
  }
  // Handle 'init' / 'setup' - CLI-based setup wizard
  else if (firstArg === 'init' || firstArg === 'setup') {
    const { handleInitCommand } = await import('./commands/init.js');
    await handleInitCommand();
    return;
  }
  // Handle 'providers' subcommands
  else if (firstArg === 'providers') {
    const { handleProvidersCommand } = await import('./commands/providers.js');
    await handleProvidersCommand(args.slice(1));
    return;
  }
  // Handle 'models' subcommands
  else if (firstArg === 'models') {
    const { handleModelsCommand } = await import('./commands/models.js');
    await handleModelsCommand(args.slice(1));
    return;
  }
  // Handle 'skills' subcommands
  else if (firstArg === 'skills') {
    const { handleSkillsCommand } = await import('./commands/skills.js');
    await handleSkillsCommand(args.slice(1));
    return;
  }
  // Handle 'stacks' subcommands
  else if (firstArg === 'stacks') {
    const { handleStacksCommand } = await import('./commands/stacks.js');
    await handleStacksCommand(args.slice(1));
    return;
  }
  // Handle 'config' command
  else if (firstArg === 'config') {
    const { handleConfigCommand } = await import('./commands/config.js');
    await handleConfigCommand(args.slice(1));
    return;
  }
  // Handle 'info' command
  else if (firstArg === 'info') {
    const { handleInfoCommand } = await import('./commands/info.js');
    await handleInfoCommand(args.slice(1));
    return;
  }
  // Handle 'status' command - shows job status or system info
  else if (firstArg === 'status') {
    const subArgs = args.slice(1);
    // If a job ID is provided, show job status
    if (subArgs.length > 0 && !subArgs[0].startsWith('-')) {
      const { handleStatusCommand } = await import('./commands/jobs.js');
      await handleStatusCommand(subArgs);
    } else {
      // Otherwise show system info
      const { handleInfoCommand } = await import('./commands/info.js');
      await handleInfoCommand(subArgs);
    }
    return;
  }
  // Handle 'jobs' command - list/manage background jobs
  else if (firstArg === 'jobs') {
    const { handleJobsCommand } = await import('./commands/jobs.js');
    await handleJobsCommand(args.slice(1));
    return;
  }
  // Handle 'history' command
  else if (firstArg === 'history') {
    const { handleHistoryCommand } = await import('./commands/history.js');
    await handleHistoryCommand(args.slice(1));
    return;
  }
  // Handle 'logs' command - job logs or alias for history
  else if (firstArg === 'logs') {
    const subArgs = args.slice(1);
    // If a job ID is provided, show job logs
    if (subArgs.length > 0 && !subArgs[0].startsWith('-')) {
      const { handleLogsCommand } = await import('./commands/jobs.js');
      await handleLogsCommand(subArgs);
    } else {
      // Otherwise show run history
      const { handleHistoryCommand } = await import('./commands/history.js');
      await handleHistoryCommand(subArgs);
    }
    return;
  }
  // Handle 'previous' / 'prev' / 'last' command
  else if (firstArg === 'previous' || firstArg === 'prev' || firstArg === 'last') {
    const { handlePreviousCommand } = await import('./commands/previous.js');
    await handlePreviousCommand(args.slice(1));
    return;
  }
  // Handle 'tldr' / 'help' command
  else if (firstArg === 'tldr' || firstArg === 'help') {
    const { handleTldrCommand } = await import('./commands/tldr.js');
    await handleTldrCommand(args.slice(1));
    return;
  }
  // Handle 'agent' command - interactive orchestrator REPL
  else if (firstArg === 'agent') {
    const agentArgs = args.slice(1);
    const { options: agentOptions } = parseArgs(agentArgs);
    const agentCwd = process.cwd();
    const config = await loadConfig(agentCwd);
    const { handleAgentRepl } = await import('./commands/agent-repl.js');
    await handleAgentRepl(config, { plain: agentOptions.plain, visuals: agentOptions.visuals });
    return;
  }
  // Handle 'claude' command - launch Claude Code with Karl-only tools
  else if (firstArg === 'claude') {
    const { handleClaudeCommand } = await import('./commands/claude.js');
    await handleClaudeCommand(args.slice(1));
    return;
  }
  // Handle 'debugdesign' command - UI simulation for design work
  else if (firstArg === 'debugdesign' || firstArg === 'dd') {
    const { handleDebugDesign } = await import('./commands/debugdesign.js');
    await handleDebugDesign(args.slice(1));
    return;
  }
  // Handle 'completions' command - shell completion scripts
  else if (firstArg === 'completions') {
    const { handleCompletionsCommand } = await import('./commands/completions.js');
    await handleCompletionsCommand(args.slice(1));
    return;
  }
  // Handle 'serve' command - JSON-RPC server for IPC
  else if (firstArg === 'serve') {
    const { handleServeCommand } = await import('./commands/serve.js');
    await handleServeCommand();
    return;
  }
  // ─────────────────────────────────────────────────────────────────────────
  // STACK-AS-VERB: Check if first arg is a known stack
  // ─────────────────────────────────────────────────────────────────────────
  else if (!firstArg.startsWith('-')) {
    // Not a flag, not a built-in command - could be a stack verb
    const isStack = await stackExists(firstArg);

    if (isStack) {
      // It's a stack! Treat as: karl <stack> <task> → karl as <stack> run <task>
      const stackName = firstArg;
      args = args.slice(1);
      args = ['--stack', stackName, ...args];
    } else {
      // Unknown command - check if it looks like a valid command name (single word, no spaces)
      const isValidCommandName = /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(firstArg);

      if (isValidCommandName) {
        // Looks like a command name - offer to create a stack (only in interactive mode)
        console.log(`Unknown command: "${firstArg}"`);

        // Check for non-interactive environment
        if (!process.stdin.isTTY) {
          console.log(`Use 'karl stacks create ${firstArg}' to create this stack, or 'karl run "your task"' to run without a named stack.`);
          process.exitCode = 1;
          return;
        }

        console.log('');

        const shouldCreate = await promptYesNo(`Create "${firstArg}" as a new command (stack)? [Y/n] `);

        if (shouldCreate) {
          await runStackCreationWizard(firstArg, args.slice(1));
        } else {
          console.log('\nAvailable commands:');
          console.log('  karl run <task>     Run an LLM query');
          console.log('  karl setup          Open config TUI');
          console.log('  karl stacks list    List available stacks');
          console.log('  karl --help         Show all commands');
        }
      } else {
        // Looks like a prompt, not a command - user probably forgot 'run'
        console.log(`Unknown command: "${firstArg.length > 40 ? firstArg.slice(0, 40) + '...' : firstArg}"`);
        console.log('');
        console.log(`Did you mean: karl run "${firstArg}"?`);
        console.log('');
        console.log('Use "karl run <task>" to send queries to the LLM.');
      }
      return;
    }
  }

  const { options, tasks: rawTasks, wantsHelp, wantsVersion, wantsLogin, wantsLogout } = parseArgs(args);

  if (wantsHelp) {
    await printHelp();
    return;
  }

  if (wantsVersion) {
    console.log(await loadVersion());
    return;
  }

  if (wantsLogin) {
    const { loginProvider } = await import('./commands/providers.js');
    await loginProvider();
    return;
  }

  if (wantsLogout) {
    const { logoutProvider } = await import('./commands/providers.js');
    // Default to anthropic for backwards compatibility
    await logoutProvider('anthropic');
    return;
  }

  const cwd = process.cwd();
  let config = await loadConfig(cwd);

  // Auto-init: if no valid provider+model, launch the init wizard
  if (!isConfigValid(config)) {
    const { runInitWizard } = await import('./commands/init.js');
    const success = await runInitWizard();
    if (!success) {
      process.exitCode = 1;
      return;
    }
    // Reload config after wizard completes
    config = await loadConfig(cwd);
    if (!isConfigValid(config)) {
      console.error('Setup incomplete. Run `karl init` to configure a provider.');
      process.exitCode = 1;
      return;
    }
  }

  // Ensure default stack exists (can't be deleted)
  const { ensureDefaultStack, defaultStackExists } = await import('./commands/init.js');
  if (!defaultStackExists()) {
    ensureDefaultStack(config.defaultModel);
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

  const needsHistoryStore = !effectiveOptions.noHistory || !!effectiveOptions.parent;
  const historyStore = needsHistoryStore ? createHistoryStore(config.history, cwd) : null;
  const recordHistory = !!historyStore && !effectiveOptions.noHistory;
  let parentId: string | undefined;
  let parentContext: string | undefined;
  if (effectiveOptions.parent) {
    if (!historyStore) {
      throw new Error('History is disabled. Enable history to use --parent.');
    }
    parentId = historyStore.resolveRunId(effectiveOptions.parent) ?? undefined;
    if (!parentId) {
      throw new Error(`Parent run not found: ${effectiveOptions.parent}`);
    }
    // Fetch parent run and inject its response as context
    const parentRun = historyStore.getRunById(parentId);
    if (parentRun?.response) {
      parentContext = `Previous response (from ${parentId}):\n\n${parentRun.response}`;
      // Prepend parent context to existing context
      effectiveOptions.context = parentContext + (effectiveOptions.context ? `\n\n${effectiveOptions.context}` : '');
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
      console.error('Run `karl --login` to authenticate.');
    } else {
      console.error(`Set the appropriate API key environment variable.`);
    }
    process.exitCode = 1;
    return;
  }
  
  const hooks = await HookRunner.load(cwd);

  const tasks: (string | null)[] = [...rawTasks];

  // Check if context should be read from stdin
  const contextFromStdin = effectiveOptions.contextFile === '-';
  const rawTask = tasks[0] ?? null;
  const explicitStdinTask = tasks.length > 0 && rawTask === null;
  const needsStdinForTask = explicitStdinTask || (tasks.length === 0 && !process.stdin.isTTY);

  // Can't read both context and task from stdin
  if (contextFromStdin && needsStdinForTask) {
    throw new Error('Cannot use both --context-file - and - for task. Choose one.');
  }

  // Read stdin if needed for context or task
  let stdinContent: string | null = null;
  let contextFilePath: string | undefined;
  let contextFileRaw: string | undefined;
  const needsStdin = contextFromStdin || needsStdinForTask;
  if (needsStdin) {
    stdinContent = (await readStdin()).trim();
  }

  // Handle context from stdin
  if (contextFromStdin && stdinContent) {
    contextFilePath = '-';
    contextFileRaw = stdinContent;
    // Append stdin content to context, clear contextFile so it's not read as a file
    effectiveOptions.context = effectiveOptions.context
      ? `${effectiveOptions.context}\n\n${stdinContent}`
      : stdinContent;
    effectiveOptions.contextFile = undefined;
  }

  if (effectiveOptions.contextFile) {
    const resolvedPath = resolveHomePath(effectiveOptions.contextFile);
    const fullPath = path.isAbsolute(resolvedPath) ? resolvedPath : path.resolve(cwd, resolvedPath);
    contextFilePath = fullPath;
    contextFileRaw = (await readTextIfExists(fullPath)) ?? undefined;
  }

  // Handle task from stdin
  const stdinTask = needsStdinForTask ? stdinContent : null;
  const finalTask = rawTask ?? stdinTask;

  if (!finalTask) {
    throw new Error('No tasks provided.');
  }

  // Background mode: launch as detached job and exit immediately
  if (effectiveOptions.background) {
    const { launchBackgroundJob } = await import('./jobs.js');
    const { jobId, pid } = launchBackgroundJob(cwd, finalTask, process.argv.slice(2));
    console.log(`Job started: ${jobId}`);
    console.log(`PID: ${pid}`);
    console.log('');
    console.log(`Use 'karl status ${jobId}' to check progress`);
    console.log(`Use 'karl logs ${jobId}' to view output`);
    return;
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
    console.log(`Task:         "${finalTask.length > 60 ? finalTask.slice(0, 60) + '...' : finalTask}"`);
    return;
  }

  const systemPrompt = await buildSystemPrompt({
    cwd,
    skill: effectiveOptions.skill,
    context: effectiveOptions.context,
    contextFile: effectiveOptions.contextFile,
    unrestricted: effectiveOptions.unrestricted
  });

  const runStartedAt = Date.now();
  const historyId = recordHistory ? buildHistoryId(new Date(runStartedAt)) : undefined;
  const thinkingEvents: HistoryThinkingEntry[] = [];
  let lastThinking = '';
  const diffs: ToolDiff[] = [];
  const contextInline = effectiveOptions.context;
  const diffConfig = recordHistory
    ? { maxBytes: config.history?.maxDiffBytes, maxLines: config.history?.maxDiffLines }
    : undefined;
  const onDiff = recordHistory ? (diff: ToolDiff) => diffs.push(diff) : undefined;
  const argvSnapshot = process.argv.slice(2);
  const command = argvSnapshot.length > 0 ? `karl ${argvSnapshot.join(' ')}` : 'karl';
  const configSnapshot = {
    stack: options.stack,
    options: {
      model: effectiveOptions.model,
      skill: effectiveOptions.skill,
      timeoutMs: effectiveOptions.timeoutMs,
      maxTokens: effectiveOptions.maxTokens,
      unrestricted: effectiveOptions.unrestricted,
      noTools: effectiveOptions.noTools
    },
    model: {
      key: resolvedModel.modelKey,
      id: resolvedModel.model,
      providerKey: resolvedModel.providerKey,
      providerType: resolvedModel.providerConfig?.type
    },
    tools: config.tools,
    retry: config.retry
  };

  const state = initState([finalTask]);
  const visualsOverride = effectiveOptions.plain ? 'plain' : effectiveOptions.visuals || undefined;
  const useVerbose = effectiveOptions.verbose && !effectiveOptions.json;
  const spinner = new Spinner(!effectiveOptions.json, useVerbose, visualsOverride);
  const statusWriter = new StatusWriter(cwd, finalTask, historyId);
  const onEvent = (event: SchedulerEvent) => {
    applyEvent(state, event);
    if (event.type === 'thinking') {
      spinner.setThinking(event.text);
      statusWriter.onThinking(event.text);
      if (recordHistory && event.text !== lastThinking) {
        thinkingEvents.push({ ts: event.time, text: event.text });
        lastThinking = event.text;
      }
    } else if (event.type === 'tool_start') {
      spinner.toolStart(event.tool, event.detail);
      statusWriter.onToolStart(event.tool, event.detail);
    } else if (event.type === 'tool_end') {
      spinner.toolEnd(event.tool, event.success);
      statusWriter.onToolEnd(event.tool, event.success);
    }
  };

  let result: Awaited<ReturnType<typeof runTask>> | null = null;
  try {
    spinner.start('');
    result = await runTaskWithRetry(
      finalTask,
      (attempt) =>
        runTask({
          task: finalTask,
          index: 0,
          attempt,
          cwd,
          model: resolvedModel.model,
          providerKey: resolvedModel.providerKey,
          providerType: resolvedModel.providerConfig?.type,
          apiKey,
          baseUrl: resolvedModel.providerConfig?.baseUrl,
          systemPrompt,
          hooks,
          toolsConfig: effectiveOptions.tools
            ? { enabled: effectiveOptions.tools, custom: config.tools.custom }
            : config.tools,
          noTools: effectiveOptions.noTools,
          unrestricted: effectiveOptions.unrestricted,
          timeoutMs: effectiveOptions.timeoutMs,
          maxTokens: effectiveOptions.maxTokens ?? resolvedModel.maxTokens,
          contextLength: resolvedModel.contextLength,
          thinking: effectiveOptions.thinking,
          cacheControl: effectiveOptions.cacheControl,
          onEvent,
          onDiff,
          diffConfig
        }),
      config.retry,
      onEvent
    );
  } finally {
    spinner.stop();
  }

  if (result) {
    // Update status file
    if (result.status === 'success') {
      statusWriter.onComplete(result.durationMs);
    } else {
      statusWriter.onError(result.error ?? 'Unknown error', result.durationMs);
    }

    printResults([result], {
      json: effectiveOptions.json,
      verbose: effectiveOptions.verbose,
      stats: effectiveOptions.stats,
      historyId
    });
    if (recordHistory && historyStore && historyId) {
      const completedAt = Date.now();
      try {
        historyStore.insertRun({
          id: historyId,
          createdAt: runStartedAt,
          completedAt,
          durationMs: result.durationMs,
          status: result.status,
          exitCode: result.status === 'success' ? 0 : 1,
          cwd,
          command,
          argv: argvSnapshot,
          stack: options.stack,
          modelKey: resolvedModel.modelKey,
          modelId: resolvedModel.model,
          providerKey: resolvedModel.providerKey,
          providerType: resolvedModel.providerConfig?.type,
          skill: effectiveOptions.skill,
          prompt: finalTask,
          response: result.result,
          error: result.error,
          thinking: thinkingEvents,
          contextFilePath,
          contextFileRaw,
          contextInline,
          systemPrompt,
          configSnapshot,
          toolsUsed: result.toolsUsed,
          tokens: result.tokens,
          diffs,
          parentId,
          tags: effectiveOptions.tags
        });
        const showHistoryId = effectiveOptions.showHistoryId ?? config.history?.showId ?? false;
        if (showHistoryId) {
          console.error(`History: ${historyId}`);
        }
      } catch (error) {
        console.error(`History error: ${formatError(error)}`);
      }
    }
  }
}

main().catch((error) => {
  console.error(formatError(error));
  process.exitCode = 1;
});
