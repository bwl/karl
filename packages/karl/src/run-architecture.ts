import type { RunPlan, RunRoute } from './run-broker.js';

export const EVIDENCE_LED_PHASES = [
  'evidence',
  'scope_gate',
  'patch',
  'verify',
  'handoff',
] as const;

export type RunPhaseId = typeof EVIDENCE_LED_PHASES[number];
export type RunPhaseKind = 'read-only' | 'human-gate' | 'mutation' | 'verification' | 'handoff';

export interface RunArchitecturePhase {
  id: RunPhaseId;
  kind: RunPhaseKind;
  dependsOn: RunPhaseId[];
  tools: {
    mode: 'none' | 'read-only' | 'read-write';
    allowed: string[];
  };
  worktree: 'source-read-only' | 'detached-required' | 'same-as-patch' | 'none';
  checks: string[];
  requiresHumanApproval: boolean;
}

export interface RunArchitecture {
  kind: 'karl.runArchitecture';
  version: 1;
  recipe: 'evidence-led-patch';
  task: string;
  cwd: string;
  sourceHead: string;
  mutationRoute: RunRoute;
  phases: RunArchitecturePhase[];
  residualRisk: string;
}

export interface ArchitectureCapabilities {
  sourceHead: string;
  verification?: string[];
}

function phase(
  id: RunPhaseId,
  kind: RunPhaseKind,
  dependsOn: RunPhaseId[],
  tools: RunArchitecturePhase['tools'],
  worktree: RunArchitecturePhase['worktree'],
  checks: string[] = [],
  requiresHumanApproval = false
): RunArchitecturePhase {
  return { id, kind, dependsOn, tools, worktree, checks, requiresHumanApproval };
}

export function compileEvidenceLedPatch(
  plan: RunPlan,
  capabilities: ArchitectureCapabilities
): RunArchitecture {
  const coder = [plan.recommended, ...plan.alternatives].find((route) => route.route === 'coder');
  if (!coder) {
    throw new Error('evidence-led-patch requires the coder route');
  }
  const mutationRoute: RunRoute = {
    ...coder,
    label: 'Magic worktree coder',
    why: 'Apply the validated coder tool policy through Karl magic in a retained detached worktree.',
    model: { provider: 'codex', model: 'configured Codex app-server model' },
    availability: { available: true, requirements: [] },
    execution: {
      mode: 'karl-magic',
      argv: ['karl', 'magic', '--worktree', '--require-clean', plan.task],
      notes: [
        'The scope gate must approve this command before Karl creates a worktree.',
        'Verification and integration remain separate phases.',
      ],
    },
  };
  const verification = capabilities.verification?.filter(Boolean) ?? ['git diff --check'];
  const architecture: RunArchitecture = {
    kind: 'karl.runArchitecture',
    version: 1,
    recipe: 'evidence-led-patch',
    task: plan.task,
    cwd: plan.cwd,
    sourceHead: capabilities.sourceHead,
    mutationRoute,
    phases: [
      phase('evidence', 'read-only', [], { mode: 'read-only', allowed: ['git-read'] }, 'source-read-only'),
      phase('scope_gate', 'human-gate', ['evidence'], { mode: 'none', allowed: [] }, 'none', [], true),
      phase('patch', 'mutation', ['scope_gate'], mutationRoute.tools, 'detached-required'),
      phase('verify', 'verification', ['patch'], { mode: 'read-only', allowed: ['shell-checks'] }, 'same-as-patch', verification),
      phase('handoff', 'handoff', ['verify'], { mode: 'none', allowed: [] }, 'same-as-patch'),
    ],
    residualRisk: 'A human still owns diff review and any later commit, merge, or push.',
  };
  validateRunArchitecture(architecture);
  return architecture;
}

export function validateRunArchitecture(architecture: RunArchitecture): void {
  if (architecture.kind !== 'karl.runArchitecture' || architecture.version !== 1) {
    throw new Error('unsupported run architecture contract');
  }
  if (architecture.recipe !== 'evidence-led-patch') {
    throw new Error(`unknown recipe: ${String(architecture.recipe)}`);
  }

  const expected = [...EVIDENCE_LED_PHASES];
  const ids = architecture.phases.map((entry) => entry.id);
  const known = new Set<string>(expected);
  if (ids.length !== expected.length || ids.some((id, index) => id !== expected[index])) {
    throw new Error(`phase order must be ${expected.join(' -> ')}`);
  }
  if (new Set(ids).size !== ids.length) {
    throw new Error('run architecture contains duplicate phases');
  }

  const byId = new Map(architecture.phases.map((entry) => [entry.id, entry]));
  for (const entry of architecture.phases) {
    for (const dependency of entry.dependsOn) {
      if (!known.has(dependency) || !byId.has(dependency)) {
        throw new Error(`phase ${entry.id} has unknown dependency ${dependency}`);
      }
    }
    if (entry.kind === 'read-only' && (entry.tools.mode === 'read-write' || entry.tools.allowed.some((tool) => /write|edit|patch|bash/i.test(tool)))) {
      throw new Error(`read-only phase ${entry.id} includes mutation tools`);
    }
    if (entry.kind === 'mutation' && entry.worktree !== 'detached-required') {
      throw new Error(`mutation phase ${entry.id} requires a detached worktree`);
    }
  }

  const visiting = new Set<RunPhaseId>();
  const visited = new Set<RunPhaseId>();
  const visit = (id: RunPhaseId): void => {
    if (visiting.has(id)) throw new Error('run architecture contains a cycle');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependsOn ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of ids) visit(id);

  const gate = byId.get('scope_gate');
  if (!gate || gate.kind !== 'human-gate' || !gate.requiresHumanApproval) {
    throw new Error('evidence-led-patch requires a human scope gate');
  }
  const verify = byId.get('verify');
  if (!verify || verify.kind !== 'verification' || verify.checks.length === 0) {
    throw new Error('evidence-led-patch requires verification checks');
  }
  if (!architecture.mutationRoute.worktree || architecture.mutationRoute.tools.mode !== 'read-write') {
    throw new Error('mutation route must permit writes only in a worktree');
  }
}
