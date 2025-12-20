#!/usr/bin/env bun
import path from 'path';
import { loadConfig, resolveModel, isConfigValid } from './config.js';
import { buildSystemPrompt } from './context.js';
import { HookRunner } from './hooks.js';
import { initState, applyEvent } from './state.js';
import { VolleyScheduler } from './scheduler.js';
import { runTask } from './runner.js';
import { printResults } from './print.js';
import { CliOptions } from './types.js';
import { formatError, parseDurationMs, readTextIfExists } from './utils.js';
import { getProviderOAuthToken } from './oauth.js';
import { Spinner } from './spinner.js';
import { loadStack, StackManager } from './stacks.js';
import { SkillManager } from './skills.js';
import { createInterface } from 'readline';

/**
 * Built-in commands that are handled specially.
 * Everything else is either a stack-as-verb or an error.
 */
const BUILTIN_COMMANDS = new Set([
  'run',       // Run task using 'default' stack
  'init',      // First-run setup wizard
  'providers', // Provider management
  'models',    // Model management
  'stacks',    // Stack management
  'skills',    // Skill management
  'info',      // System info
  'as',        // Legacy stack syntax
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
karl <command> <task>       (stack as verb)

Built-in Commands:
  run <task>                Run a single task
  init                      First-time setup wizard
  providers                 Manage providers (add, login, logout)
  models                    Manage models (add, remove, list)
  stacks                    Manage config stacks
  skills                    Manage agent skills
  info                      Show system info (--json for JSON)
${stackVerbs}
Flags (use with 'run'):
  --model, -m          Model alias or exact model id
  --verbose, -v        Stream thoughts and tool calls
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
  --volley             Enable multi-task mode (task1 task2 ...)
  -                    Read task from stdin
  --dry-run            Show config without running
  --help, -h           Show help
  --version            Show version

Providers Commands:
  karl providers list           List configured providers
  karl providers add [name]     Add a new provider
  karl providers remove <name>  Remove a provider
  karl providers login [name]   Login to OAuth provider
  karl providers logout <name>  Logout from OAuth provider

Models Commands:
  karl models list              List configured models
  karl models add [alias]       Add a new model (interactive)
  karl models remove <alias>    Remove a model
  karl models default <alias>   Set the default model

Stacks Commands:
  karl stacks list              List available stacks
  karl stacks show <name>       Show stack details
  karl stacks create <name>     Create a new stack
  karl stacks edit <name>       Edit a stack
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
      case '--model':
      case '-m':
        options.model = requireValue(flag, inlineValue ?? argv[++i]);
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
      case '--volley':
        options.volley = true;
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

  // Validate: multiple positional args require --volley or --tasks-file
  if (tasks.length > 1 && !options.volley && !options.tasksFile) {
    throw new Error(
      `Multiple tasks require --volley flag.\n` +
      `  Got: ${tasks.map(t => `"${t}"`).join(' ')}\n` +
      `  Use: karl run --volley "task1" "task2" ...`
    );
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

  // No args = show help
  if (!firstArg) {
    await printHelp();
    return;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // COMMAND DISPATCH
  // ─────────────────────────────────────────────────────────────────────────

  // Handle 'run' command - uses 'default' stack
  if (firstArg === 'run') {
    args = args.slice(1);  // Remove 'run', rest are flags + tasks
    // Always use 'default' stack (unless --stack is explicitly specified)
    if (!args.includes('--stack')) {
      args = ['--stack', 'default', ...args];
    }
  }
  // Handle 'init' - CLI-based setup wizard
  else if (firstArg === 'init') {
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
  // Handle 'info' command
  else if (firstArg === 'info') {
    const { handleInfoCommand } = await import('./commands/info.js');
    await handleInfoCommand(args.slice(1));
    return;
  }
  // Handle legacy 'as <stack>' syntax
  else if (firstArg === 'as' && args.length >= 2) {
    const stackName = args[1];
    args = args.slice(2);
    // Inject stack into args for parseArgs
    args = ['--stack', stackName, ...args];
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
        // Looks like a command name - offer to create a stack
        console.log(`Unknown command: "${firstArg}"`);
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
  const useVerbose = effectiveOptions.verbose && !effectiveOptions.json;
  const spinner = new Spinner(!effectiveOptions.json, useVerbose);

  const scheduler = new VolleyScheduler(
    {
      maxConcurrent: effectiveOptions.maxConcurrent ?? config.volley.maxConcurrent,
      retryAttempts: config.volley.retryAttempts,
      retryBackoff: config.volley.retryBackoff,
      timeoutMs: effectiveOptions.timeoutMs
    },
    (event) => {
      applyEvent(state, event);
    }
  );

  let results: Awaited<ReturnType<typeof scheduler.run>> | null = null;
  try {
    if (finalTasks.length === 1) {
      spinner.start('');
    } else if (finalTasks.length > 1) {
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
        baseUrl: resolvedModel.providerConfig?.baseUrl,
        systemPrompt,
        hooks,
        toolsConfig: config.tools,
        noTools: effectiveOptions.noTools,
        unrestricted: effectiveOptions.unrestricted,
        timeoutMs: effectiveOptions.timeoutMs,
        maxTokens: effectiveOptions.maxTokens ?? resolvedModel.maxTokens,
        contextLength: resolvedModel.contextLength,
        onEvent: (event) => {
          applyEvent(state, event);
          if (event.type === 'thinking') {
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
