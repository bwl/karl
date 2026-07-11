import path from 'path';
import { createInterface } from 'readline';
import { loadConfig } from '../config.js';
import { buildHistoryId, createHistoryStore, type HistoryStore } from '../history.js';
import { resolveKarlInvocation } from '../orchestrator.js';
import { compileEvidenceLedPatch, type RunArchitecture, type RunPhaseId } from '../run-architecture.js';
import { buildRunPlan, selectRoute, type BrokerContext, type RunPlan, type RunRoute, type RouteSelection } from '../run-broker.js';
import { resolveHomePath } from '../utils.js';

interface RouteOptions {
  command: 'plan' | 'select' | 'architect' | 'execute';
  json: boolean;
  approved: boolean;
  route?: string;
  recipe?: string;
  verification: string[];
  cwd: string;
  task?: string;
}

interface GitEvidence {
  sourceHead: string;
  branch: string;
  clean: boolean;
  status: string[];
}

interface MagicResult {
  id?: string;
  status: 'success' | 'error';
  result?: string;
  cwd?: string;
  worktree?: string;
  error?: string;
  receipt?: {
    commands?: Array<{ command: string; exitCode?: number | null }>;
    filesChanged?: string[];
  };
}

interface VerificationResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface ArchitectureHandoff {
  kind: 'karl.runHandoff';
  version: 1;
  recipe: 'evidence-led-patch';
  architecture: RunArchitecture;
  runId: string;
  status: 'success' | 'error' | 'rejected';
  sourceHead: string;
  sourceCwd: string;
  sourceTreeUnchanged: boolean;
  worktree?: string;
  worktreeHead?: string;
  changedFiles: string[];
  verification: VerificationResult[];
  unresolvedFailures: string[];
  residualRisk: string;
  integration: string;
}

function parseArgs(args: string[]): RouteOptions {
  const options: RouteOptions = {
    command: 'plan',
    json: false,
    approved: false,
    verification: [],
    cwd: process.cwd(),
  };
  const taskParts: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === 'plan' || arg === 'explain') {
      options.command = 'plan';
    } else if (arg === 'select') {
      options.command = 'select';
    } else if (arg === 'architect') {
      options.command = 'architect';
    } else if (arg === 'execute' || arg === 'exec') {
      options.command = 'execute';
    } else if (arg === '--json' || arg === '-j') {
      options.json = true;
    } else if (arg === '--yes' || arg === '--approve') {
      options.approved = true;
    } else if ((arg === '--route' || arg === '-r') && args[i + 1]) {
      options.route = args[++i];
    } else if (arg === '--recipe' && args[i + 1]) {
      options.recipe = args[++i];
    } else if (arg === '--verify' && args[i + 1]) {
      options.verification.push(args[++i]);
    } else if (arg === '--cwd' && args[i + 1]) {
      options.cwd = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      printRouteHelp();
      process.exit(0);
    } else {
      taskParts.push(arg);
    }
  }

  if (taskParts.length > 0) options.task = taskParts.join(' ');
  return options;
}

async function readTaskFromStdin(): Promise<string | undefined> {
  if (process.stdin.isTTY) return undefined;
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
karl route architect [--json] [--verify <command>] [--cwd <path>] <task>
karl route execute --recipe evidence-led-patch [--yes] [--json] [--verify <command>] [--cwd <path>] <task>

The broker plans routes. The evidence-led-patch recipe is the only executable
architecture: read evidence, require approval, patch in a retained detached
worktree, verify there, and hand the result back without integrating it.
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
    defaultModelLabel: defaultModel ? `${config.defaultModel}::${defaultModel.provider}/${defaultModel.model}` : undefined,
    hasDefaultModel: !!defaultModel,
    openRouterConfigured: !!openRouter,
    openRouterAuthenticated: !!openRouter && providerAuthenticated(openRouter.apiKey),
  };
}

function runGit(cwd: string, args: string[]): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(['git', '-C', cwd, ...args], { stdout: 'pipe', stderr: 'pipe' });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString().trim(),
    stderr: result.stderr.toString().trim(),
  };
}

function collectGitEvidence(cwd: string): GitEvidence {
  const head = runGit(cwd, ['rev-parse', 'HEAD']);
  if (head.exitCode !== 0) throw new Error(`evidence-led-patch needs a git repository: ${head.stderr}`);
  const branch = runGit(cwd, ['branch', '--show-current']);
  const status = runGit(cwd, ['status', '--porcelain=v1']);
  if (status.exitCode !== 0) throw new Error(`could not inspect source status: ${status.stderr}`);
  const lines = status.stdout ? status.stdout.split('\n') : [];
  return { sourceHead: head.stdout, branch: branch.stdout || '(detached)', clean: lines.length === 0, status: lines };
}

function compactJson(value: unknown): string { return JSON.stringify(value); }
function formatAvailability(route: RunRoute): string {
  return route.availability.available ? 'available' : `needs ${route.availability.requirements.join(', ')}`;
}
function formatTools(route: RunRoute): string {
  return route.tools.mode === 'none' ? 'local tools off' : `${route.tools.mode} (${route.tools.allowed.join(', ')})`;
}
function printRoute(route: RunRoute, label: string): void {
  console.log(`${label}: ${route.label} (${route.route})`);
  console.log(`  Why: ${route.why}`);
  if (route.model.provider) console.log(`  Provider: ${route.model.provider}`);
  console.log(`  Model: ${route.model.model}`);
  if (route.model.request) console.log(`  Request: ${compactJson(route.model.request)}`);
  console.log(`  Tools: ${formatTools(route)}`);
  console.log(`  Worktree: ${route.worktree ? 'yes' : 'no'}`);
  console.log(`  Availability: ${formatAvailability(route)}`);
  console.log(`  Verification: ${route.verification.join('; ')}`);
}
function printPlan(plan: RunPlan): void {
  console.log(`Run plan: ${plan.interpretation.intent} / ${plan.interpretation.risk}`);
  console.log(`Task: ${plan.task}`);
  console.log(`Cwd: ${plan.cwd}`);
  console.log(`Interpretation: ${plan.interpretation.summary}\n`);
  printRoute(plan.recommended, 'Recommended');
  console.log('\nAlternatives:');
  for (const route of plan.alternatives) console.log(`  ${route.id}. ${route.label} (${route.route}) - ${route.tradeoff} [${formatAvailability(route)}]`);
}
function printSelection(selection: RouteSelection): void {
  printRoute(selection.selected, 'Selected');
  console.log(`\nDecision: ${selection.decision}`);
  console.log(`Residual risk: ${selection.residualRisk}`);
  console.log(`Execution mode: ${selection.selected.execution.mode}`);
  console.log(`Execution argv: ${selection.selected.execution.argv.join(' ')}`);
  for (const note of selection.selected.execution.notes) console.log(`Note: ${note}`);
}
function printArchitecture(architecture: RunArchitecture, evidence: GitEvidence): void {
  console.log(`Run architecture: ${architecture.recipe}`);
  console.log(`Task: ${architecture.task}`);
  console.log(`Source: ${architecture.cwd} @ ${architecture.sourceHead.slice(0, 12)} (${evidence.branch})`);
  console.log(`Evidence: source tree ${evidence.clean ? 'clean' : `dirty (${evidence.status.length} entries)`}`);
  console.log('Phases:');
  for (const entry of architecture.phases) {
    const checks = entry.checks.length ? `; checks: ${entry.checks.join('; ')}` : '';
    console.log(`  ${entry.id}: ${entry.kind}; tools ${entry.tools.mode}; worktree ${entry.worktree}${checks}`);
  }
  console.log(`Mutation: ${architecture.mutationRoute.label} in a new retained detached worktree`);
  console.log(`Residual risk: ${architecture.residualRisk}`);
}

async function confirmArchitecture(): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question('Approve creation of the patch worktree? [y/N] ', (answer) => {
    rl.close();
    resolve(/^y(?:es)?$/i.test(answer.trim()));
  }));
}

function phaseEvent(store: HistoryStore | null, runId: string, phase: RunPhaseId, started: boolean, payload?: unknown, success?: boolean): void {
  store?.appendRunEvent(runId, { type: started ? 'phase_started' : 'phase_finished', payload: { phase, ...((payload && typeof payload === 'object') ? payload : {}) }, success });
}

async function spawnMagic(architecture: RunArchitecture, parentId: string): Promise<{ result: MagicResult; command: string }> {
  const invocation = resolveKarlInvocation();
  const instructions = [
    'Implement only the requested task in this detached worktree.',
    'Do not commit, merge, push, remove a worktree, or modify the source worktree.',
    'Keep the patch focused. Karl will run the declared verification checks after this turn.',
  ].join(' ');
  const args = [
    ...invocation.argsPrefix,
    'magic', '--json', '--worktree', '--require-clean', '--cwd', architecture.cwd,
    '--instructions', instructions, architecture.task,
  ];
  const proc = Bun.spawn([invocation.command, ...args], {
    cwd: architecture.cwd,
    env: { ...process.env, KARL_ROUTE_PARENT_ID: parentId },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  let result: MagicResult;
  try {
    result = JSON.parse(stdout) as MagicResult;
  } catch {
    result = { status: 'error', error: stderr.trim() || `magic exited ${exitCode} without a JSON receipt` };
  }
  if (exitCode !== 0) result.status = 'error';
  return { result, command: [invocation.display, ...args.slice(invocation.argsPrefix.length)].join(' ') };
}

async function runVerification(worktree: string, commands: string[]): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];
  const bounded = (value: string): string => {
    const trimmed = value.trim();
    return trimmed.length > 4000 ? `${trimmed.slice(0, 4000)}\n[output truncated]` : trimmed;
  };
  for (const command of commands) {
    const proc = Bun.spawn(['/bin/sh', '-lc', command], { cwd: worktree, stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
    ]);
    results.push({ command, exitCode, stdout: bounded(stdout), stderr: bounded(stderr) });
  }
  return results;
}

function changedFiles(worktree: string): string[] {
  const status = runGit(worktree, ['status', '--porcelain=v1']);
  if (status.exitCode !== 0 || !status.stdout) return [];
  return status.stdout.split('\n').map((line) => line.slice(3).trim()).filter(Boolean);
}

async function executeArchitecture(architecture: RunArchitecture, evidence: GitEvidence, approved: boolean, json: boolean): Promise<ArchitectureHandoff> {
  const config = await loadConfig(architecture.cwd);
  const store = createHistoryStore(config.history, architecture.cwd);
  if (!store) {
    throw new Error('evidence-led-patch requires durable history; enable history before execution');
  }
  const runId = buildHistoryId();
  const startedAt = Date.now();
  store?.startRun({
    id: runId, createdAt: startedAt, cwd: architecture.cwd,
    command: 'karl route execute', argv: process.argv.slice(2), prompt: architecture.task,
    configSnapshot: { architecture }, tags: ['route', 'architecture', 'evidence-led-patch'],
  });
  phaseEvent(store, runId, 'evidence', true);
  phaseEvent(store, runId, 'evidence', false, evidence, true);
  phaseEvent(store, runId, 'scope_gate', true, { approved });

  if (!approved) {
    phaseEvent(store, runId, 'scope_gate', false, { approved: false }, false);
    const handoff: ArchitectureHandoff = {
      kind: 'karl.runHandoff', version: 1, recipe: 'evidence-led-patch', runId,
      architecture,
      status: 'rejected', sourceHead: evidence.sourceHead, sourceCwd: architecture.cwd,
      sourceTreeUnchanged: true, changedFiles: [], verification: [],
      unresolvedFailures: ['Scope gate was not approved; no worktree was created.'],
      residualRisk: architecture.residualRisk,
      integration: 'No commit, merge, or push was performed.',
    };
    const completedAt = Date.now();
    store?.finishRun(runId, { completedAt, durationMs: completedAt - startedAt, status: 'error', terminalReason: 'canceled', exitCode: 1, response: JSON.stringify(handoff) });
    store?.close();
    return handoff;
  }

  phaseEvent(store, runId, 'scope_gate', false, { approved: true }, true);
  phaseEvent(store, runId, 'patch', true, { sourceHead: evidence.sourceHead });
  const magic = await spawnMagic(architecture, runId);
  const worktree = magic.result.worktree;
  phaseEvent(store, runId, 'patch', false, { command: magic.command, childRunId: magic.result.id, worktree }, magic.result.status === 'success');

  let verification: VerificationResult[] = [];
  phaseEvent(store, runId, 'verify', true, { worktree });
  if (worktree) {
    verification = await runVerification(worktree, architecture.phases.find((entry) => entry.id === 'verify')!.checks);
    phaseEvent(store, runId, 'verify', false, { commands: verification }, verification.every((entry) => entry.exitCode === 0));
  } else {
    phaseEvent(store, runId, 'verify', false, { skipped: true, reason: 'patch runner returned no worktree' }, false);
  }

  const sourceNow = collectGitEvidence(architecture.cwd);
  const sourceTreeUnchanged = sourceNow.sourceHead === evidence.sourceHead && JSON.stringify(sourceNow.status) === JSON.stringify(evidence.status);
  const worktreeHead = worktree ? runGit(worktree, ['rev-parse', 'HEAD']).stdout || undefined : undefined;
  const failures: string[] = [];
  if (magic.result.status !== 'success') failures.push(magic.result.error || 'Patch runner failed.');
  if (!worktree) failures.push('Patch runner did not return a retained worktree path.');
  for (const result of verification.filter((entry) => entry.exitCode !== 0)) failures.push(`Verification failed (${result.exitCode}): ${result.command}`);
  if (!sourceTreeUnchanged) failures.push('Source worktree changed during execution.');
  if (worktreeHead && worktreeHead !== evidence.sourceHead) failures.push('Worktree HEAD changed; commits are outside this recipe.');
  const status = failures.length === 0 ? 'success' : 'error';

  phaseEvent(store, runId, 'handoff', true, { worktree });
  const handoff: ArchitectureHandoff = {
    kind: 'karl.runHandoff', version: 1, recipe: 'evidence-led-patch', runId, status,
    architecture,
    sourceHead: evidence.sourceHead, sourceCwd: architecture.cwd, sourceTreeUnchanged,
    worktree, worktreeHead, changedFiles: worktree ? changedFiles(worktree) : [], verification,
    unresolvedFailures: failures, residualRisk: architecture.residualRisk,
    integration: worktreeHead === evidence.sourceHead
      ? 'Karl orchestration performed no commit, merge, or push; the worktree remains at the source HEAD.'
      : 'Karl orchestration performed no merge or push; inspect the retained worktree because its HEAD could not be verified.',
  };
  phaseEvent(store, runId, 'handoff', false, handoff, status === 'success');
  const completedAt = Date.now();
  store?.finishRun(runId, {
    completedAt, durationMs: completedAt - startedAt, status: status === 'success' ? 'success' : 'error',
    terminalReason: status === 'success' ? 'succeeded' : 'failed', exitCode: status === 'success' ? 0 : 1,
    response: JSON.stringify(handoff), error: failures.length ? failures.join('\n') : undefined,
    toolsUsed: ['git-read', 'magic-worktree', 'shell-checks'],
  });
  store?.close();
  if (!json && worktree) console.log(`Worktree retained: ${worktree}`);
  return handoff;
}

async function resolveTask(options: RouteOptions): Promise<string | undefined> {
  return options.task ?? readTaskFromStdin();
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

  try {
    const context = await buildBrokerContext(resolvedCwd);
    const plan = buildRunPlan({ task, context, selectedRoute: options.route });
    if (options.command === 'select') {
      const selection = selectRoute(plan, options.route);
      options.json ? console.log(JSON.stringify(selection, null, 2)) : printSelection(selection);
      return;
    }
    if (options.command === 'plan') {
      options.json ? console.log(JSON.stringify(plan, null, 2)) : printPlan(plan);
      return;
    }

    if (options.recipe && options.recipe !== 'evidence-led-patch') throw new Error(`unknown recipe: ${options.recipe}`);
    if (options.command === 'execute' && options.recipe !== 'evidence-led-patch') {
      throw new Error('route execute requires --recipe evidence-led-patch');
    }
    const evidence = collectGitEvidence(resolvedCwd);
    const architecture = compileEvidenceLedPatch(plan, {
      sourceHead: evidence.sourceHead,
      verification: options.verification.length ? options.verification : undefined,
    });
    if (options.command === 'architect') {
      options.json ? console.log(JSON.stringify(architecture, null, 2)) : printArchitecture(architecture, evidence);
      return;
    }

    if (!options.json) printArchitecture(architecture, evidence);
    const approved = options.approved || await confirmArchitecture();
    const handoff = await executeArchitecture(architecture, evidence, approved, options.json);
    if (options.json) console.log(JSON.stringify(handoff, null, 2));
    else {
      console.log(`Handoff: ${handoff.status}`);
      console.log(`Changed files: ${handoff.changedFiles.join(', ') || 'none'}`);
      for (const failure of handoff.unresolvedFailures) console.log(`Unresolved: ${failure}`);
      console.log(handoff.integration);
    }
    if (handoff.status !== 'success') process.exitCode = 1;
  } catch (error) {
    console.error(`route error: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
