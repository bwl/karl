import path from 'path';
import { loadConfig } from '../config.js';
import { buildRunPlan, selectRoute, type BrokerContext, type RunPlan, type RunRoute, type RouteSelection } from '../run-broker.js';
import { resolveHomePath } from '../utils.js';

interface RouteOptions {
  command: 'plan' | 'select';
  json: boolean;
  route?: string;
  cwd: string;
  task?: string;
}

function parseArgs(args: string[]): RouteOptions {
  const options: RouteOptions = {
    command: 'plan',
    json: false,
    cwd: process.cwd(),
  };
  const taskParts: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === 'plan' || arg === 'explain') {
      options.command = 'plan';
    } else if (arg === 'select' || arg === 'execute' || arg === 'exec') {
      options.command = 'select';
    } else if (arg === '--json' || arg === '-j') {
      options.json = true;
    } else if ((arg === '--route' || arg === '-r') && args[i + 1]) {
      options.route = args[++i];
    } else if (arg === '--cwd' && args[i + 1]) {
      options.cwd = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      printRouteHelp();
      process.exit(0);
    } else {
      taskParts.push(arg);
    }
  }

  if (taskParts.length > 0) {
    options.task = taskParts.join(' ');
  }
  return options;
}

async function readTaskFromStdin(): Promise<string | undefined> {
  if (process.stdin.isTTY) {
    return undefined;
  }
  const chunks: string[] = [];
  const reader = Bun.stdin.stream().getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(decoder.decode(value, { stream: true }));
  }
  return chunks.join('').trim() || undefined;
}

function printRouteHelp(): void {
  console.log(`karl route plan [--json] [--route <id|name>] [--cwd <path>] <task>
karl route select [--json] [--route <id|name>] [--cwd <path>] <task>

Agent-facing run broker. It interprets a task, proposes routes, and materializes
the selected route as JSON or text. It does not silently replace karl run.

Examples:
  karl route plan --json "implement the verifier"
  echo "compare approaches" | karl route plan --json
  karl route select --route panel --json "compare approaches"
`);
}

function providerAuthenticated(apiKey: unknown): boolean {
  return typeof apiKey === 'string' && apiKey.length > 0 && !apiKey.includes('${');
}

async function buildBrokerContext(cwd: string): Promise<BrokerContext> {
  const config = await loadConfig(cwd);
  const defaultModel = config.models?.[config.defaultModel];
  const openRouter = config.providers?.openrouter;
  return {
    cwd,
    defaultModelLabel: defaultModel
      ? `${config.defaultModel}::${defaultModel.provider}/${defaultModel.model}`
      : undefined,
    hasDefaultModel: !!defaultModel,
    openRouterConfigured: !!openRouter,
    openRouterAuthenticated: !!openRouter && providerAuthenticated(openRouter.apiKey),
  };
}

function compactJson(value: unknown): string {
  return JSON.stringify(value);
}

function formatAvailability(route: RunRoute): string {
  if (route.availability.available) {
    return 'available';
  }
  return `needs ${route.availability.requirements.join(', ')}`;
}

function formatTools(route: RunRoute): string {
  if (route.tools.mode === 'none') {
    return 'local tools off';
  }
  return `${route.tools.mode} (${route.tools.allowed.join(', ')})`;
}

function printRoute(route: RunRoute, label: string): void {
  console.log(`${label}: ${route.label} (${route.route})`);
  console.log(`  Why: ${route.why}`);
  if (route.model.provider) {
    console.log(`  Provider: ${route.model.provider}`);
  }
  console.log(`  Model: ${route.model.model}`);
  if (route.model.request) {
    console.log(`  Request: ${compactJson(route.model.request)}`);
  }
  console.log(`  Tools: ${formatTools(route)}`);
  console.log(`  Worktree: ${route.worktree ? 'yes' : 'no'}`);
  console.log(`  Availability: ${formatAvailability(route)}`);
  console.log(`  Verification: ${route.verification.join('; ')}`);
}

function printPlan(plan: RunPlan): void {
  console.log(`Run plan: ${plan.interpretation.intent} / ${plan.interpretation.risk}`);
  console.log(`Task: ${plan.task}`);
  console.log(`Cwd: ${plan.cwd}`);
  console.log(`Interpretation: ${plan.interpretation.summary}`);
  console.log('');
  printRoute(plan.recommended, 'Recommended');
  console.log('');
  console.log('Alternatives:');
  for (const route of plan.alternatives) {
    console.log(`  ${route.id}. ${route.label} (${route.route}) - ${route.tradeoff} [${formatAvailability(route)}]`);
  }
}

function printSelection(selection: RouteSelection): void {
  printRoute(selection.selected, 'Selected');
  console.log('');
  console.log(`Decision: ${selection.decision}`);
  console.log(`Residual risk: ${selection.residualRisk}`);
  console.log(`Execution mode: ${selection.selected.execution.mode}`);
  console.log(`Execution argv: ${selection.selected.execution.argv.join(' ')}`);
  for (const note of selection.selected.execution.notes) {
    console.log(`Note: ${note}`);
  }
}

async function resolveTask(options: RouteOptions): Promise<string | undefined> {
  if (options.task) {
    return options.task;
  }
  return readTaskFromStdin();
}

export async function handleRouteCommand(args: string[]): Promise<void> {
  const options = parseArgs(args);
  const resolvedCwd = path.resolve(resolveHomePath(options.cwd));
  const task = await resolveTask({ ...options, cwd: resolvedCwd });

  if (!task) {
    printRouteHelp();
    process.exitCode = 1;
    return;
  }

  const context = await buildBrokerContext(resolvedCwd);
  const plan = buildRunPlan({
    task,
    context,
    selectedRoute: options.route,
  });

  if (options.command === 'select') {
    const selection = selectRoute(plan, options.route);
    if (options.json) {
      console.log(JSON.stringify(selection, null, 2));
    } else {
      printSelection(selection);
    }
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(plan, null, 2));
  } else {
    printPlan(plan);
  }
}
