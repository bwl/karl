import { buildRunCard, reduce, selectedOption, type BrokerState, type RunCard, type RunOption } from './logic.js';

interface CliOptions {
  command: 'plan' | 'execute';
  json: boolean;
  route?: string;
  task?: string;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    command: 'plan',
    json: false,
  };
  const taskParts: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === 'plan' || arg === 'execute') {
      options.command = arg;
    } else if (arg === '--json' || arg === '-j') {
      options.json = true;
    } else if ((arg === '--route' || arg === '-r') && args[i + 1]) {
      options.route = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
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

function printUsage(): void {
  console.log(`PROTOTYPE - Karl run broker

Usage:
  bun run prototype:run-broker -- plan [--json] <task>
  bun run prototype:run-broker -- execute [--route <id|route>] [--json] <task>

Examples:
  bun run prototype:run-broker -- plan --json "implement the verifier"
  echo "compare these approaches" | bun run prototype:run-broker -- plan --json
  bun run prototype:run-broker -- execute --route panel "compare route options"
`);
}

function findRoute(card: RunCard, route?: string): RunOption {
  if (!route) {
    return card.options.find((option) => option.id === card.recommendedId) ?? card.options[0];
  }

  const normalized = route.toLowerCase();
  return card.options.find((option) =>
    option.id === normalized ||
    option.route === normalized ||
    option.label.toLowerCase() === normalized
  ) ?? card.options[0];
}

function createStateFromCard(card: RunCard, selected: RunOption): BrokerState {
  return {
    phase: 'selected',
    task: card.task,
    scenarioIndex: -1,
    card,
    selectedId: selected.id,
    autoAccept: false,
  };
}

function routeSummary(option: RunOption): Record<string, unknown> {
  return {
    id: option.id,
    label: option.label,
    route: option.route,
    why: option.why,
    model: option.model.model,
    request: option.model.request ?? null,
    localTools: option.localTools,
    worktree: option.worktree,
    verification: option.verification,
    tradeoff: option.tradeoff,
  };
}

function planJson(card: RunCard, selected: RunOption): Record<string, unknown> {
  return {
    kind: 'karl.runPlan.prototype',
    task: card.task,
    interpretation: card.interpretation,
    intent: card.intent,
    risk: card.risk,
    recommendedRoute: selected.route,
    recommended: routeSummary(selected),
    alternatives: card.options
      .filter((option) => option.id !== selected.id)
      .map(routeSummary),
  };
}

function printPlanText(card: RunCard, selected: RunOption): void {
  console.log(`Run plan: ${card.intent} / ${card.risk}`);
  console.log(`Task: ${card.task}`);
  console.log(`Interpretation: ${card.interpretation}`);
  console.log('');
  console.log(`Recommended: ${selected.label}`);
  console.log(`Why: ${selected.why}`);
  console.log(`Model: ${selected.model.model}`);
  if (selected.model.request) {
    console.log(`Request: ${JSON.stringify(selected.model.request)}`);
  }
  console.log(`Tools: ${selected.localTools ? 'local tools on' : 'local tools off'}`);
  console.log(`Worktree: ${selected.worktree ? 'yes' : 'no'}`);
  console.log(`Verification: ${selected.verification.join('; ')}`);
  console.log('');
  console.log('Alternatives:');
  for (const option of card.options.filter((entry) => entry.id !== selected.id)) {
    console.log(`  ${option.id}. ${option.label} (${option.route}) - ${option.tradeoff}`);
  }
}

function executeJson(state: BrokerState): Record<string, unknown> {
  const selected = selectedOption(state);
  const executed = reduce(state, { type: 'execute' });
  return {
    kind: 'karl.runReceipt.prototype',
    task: executed.task,
    selected: routeSummary(selected),
    receipt: executed.receipt,
  };
}

function printExecuteText(state: BrokerState): void {
  const output = executeJson(state);
  const selected = output.selected as Record<string, unknown>;
  const receipt = output.receipt as Record<string, unknown>;
  console.log(`Would execute: ${selected.label}`);
  console.log(`Route: ${selected.route}`);
  console.log(`Model: ${selected.model}`);
  console.log(`Decision: ${receipt.decision}`);
  console.log(`Residual risk: ${receipt.residualRisk}`);
}

const options = parseArgs(Bun.argv.slice(2));
const stdinTask = await readTaskFromStdin();
const task = options.task ?? stdinTask;

if (!task) {
  printUsage();
  process.exit(1);
}

const card = buildRunCard(task);
const selected = findRoute(card, options.route);
const state = createStateFromCard(card, selected);

if (options.command === 'execute') {
  if (options.json) {
    console.log(JSON.stringify(executeJson(state), null, 2));
  } else {
    printExecuteText(state);
  }
} else if (options.json) {
  console.log(JSON.stringify(planJson(card, selected), null, 2));
} else {
  printPlanText(card, selected);
}
