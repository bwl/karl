export type Intent = 'code' | 'review' | 'ideation' | 'compare' | 'experiment';
export type Risk = 'low' | 'medium' | 'high';
export type RouteKind = 'coder' | 'panel' | 'cheap' | 'bodyplan' | 'direct';
export type Phase = 'planning' | 'selected' | 'executed';

export interface RequestBody {
  model: string;
  request?: Record<string, unknown>;
}

export interface RunOption {
  id: string;
  label: string;
  route: RouteKind;
  why: string;
  model: RequestBody;
  localTools: boolean;
  worktree: boolean;
  verification: string[];
  tradeoff: string;
}

export interface RunCard {
  task: string;
  interpretation: string;
  intent: Intent;
  risk: Risk;
  recommendedId: string;
  options: RunOption[];
}

export interface Receipt {
  selected: RunOption;
  decision: string;
  residualRisk: string;
}

export interface BrokerState {
  phase: Phase;
  task: string;
  scenarioIndex: number;
  card: RunCard;
  selectedId: string;
  autoAccept: boolean;
  receipt?: Receipt;
}

export type BrokerAction =
  | { type: 'cycleScenario'; direction: 1 | -1 }
  | { type: 'select'; id: string }
  | { type: 'toggleAuto' }
  | { type: 'execute' }
  | { type: 'reset' };

export const SCENARIOS = [
  'implement MPR-107 packet 5 verifier in the Morley Godot pipeline',
  'compare approaches for making Karl choose OpenRouter routes automatically',
  'give me three weird no-tools ideas for Morley terrain names',
  'build request bodies for a multi-model poetry and architecture comparison',
  'review this diff for security and behavioral regressions',
];

const codeWords = /\b(implement|fix|debug|refactor|test|verifier|pipeline|build|code)\b/i;
const reviewWords = /\b(review|audit|risk|security|regression|diff)\b/i;
const compareWords = /\b(compare|options|approaches|tradeoff|which|argue)\b/i;
const experimentWords = /\b(body|request bodies|multi-model|benchmark|experiment|matrix)\b/i;
const ideationWords = /\b(ideas|brainstorm|weird|names|sketch|cheap|no-tools)\b/i;

export function interpretTask(task: string): { intent: Intent; risk: Risk; interpretation: string } {
  if (experimentWords.test(task)) {
    return {
      intent: 'experiment',
      risk: 'medium',
      interpretation: 'Model-routing experiment that benefits from generated request bodies.',
    };
  }
  if (codeWords.test(task)) {
    return {
      intent: 'code',
      risk: 'high',
      interpretation: 'Repo-editing implementation task with verification and isolation needs.',
    };
  }
  if (reviewWords.test(task)) {
    return {
      intent: 'review',
      risk: 'medium',
      interpretation: 'Read-heavy review task where local edits should stay off by default.',
    };
  }
  if (compareWords.test(task)) {
    return {
      intent: 'compare',
      risk: 'medium',
      interpretation: 'Decision support task where a panel can expose disagreement.',
    };
  }
  if (ideationWords.test(task)) {
    return {
      intent: 'ideation',
      risk: 'low',
      interpretation: 'Low-risk no-tools ideation task where cost and speed matter.',
    };
  }
  return {
    intent: 'ideation',
    risk: 'low',
    interpretation: 'Unclear lightweight task; start cheap and escalate if needed.',
  };
}

function pareto(score: number, sessionId: string): RequestBody {
  return {
    model: 'openrouter/pareto-code',
    request: {
      plugins: [{ id: 'pareto-router', min_coding_score: score }],
      session_id: sessionId,
    },
  };
}

const OPTIONS: Record<RouteKind, Omit<RunOption, 'id'>> = {
  coder: {
    label: 'Worktree coder',
    route: 'coder',
    why: 'Use this when Karl should edit a repo and leave a gateable diff.',
    model: pareto(0.66, 'karl-prototype-session'),
    localTools: true,
    worktree: true,
    verification: ['bun run typecheck', 'targeted test command from run card'],
    tradeoff: 'Highest setup cost, best containment.',
  },
  panel: {
    label: 'Panel first',
    route: 'panel',
    why: 'Use this when disagreement is more useful than immediate action.',
    model: {
      model: 'openrouter/fusion',
      request: {
        plugins: [{ id: 'fusion' }],
        tool_choice: 'required',
      },
    },
    localTools: false,
    worktree: false,
    verification: ['human reads the options before execution'],
    tradeoff: 'Good judgment, no repo access unless followed by another route.',
  },
  cheap: {
    label: 'Cheap sketch',
    route: 'cheap',
    why: 'Use this when a rough first pass is enough.',
    model: { model: 'openrouter/free' },
    localTools: false,
    worktree: false,
    verification: ['none; output is disposable'],
    tradeoff: 'Low cost, low guarantees.',
  },
  bodyplan: {
    label: 'Body-builder plan',
    route: 'bodyplan',
    why: 'Use this to generate candidate OpenRouter request bodies for experiments.',
    model: { model: 'openrouter/bodybuilder' },
    localTools: false,
    worktree: false,
    verification: ['Karl validates generated request bodies before execution'],
    tradeoff: 'Meta-routing; useful before a batch, not for direct answers.',
  },
  direct: {
    label: 'Direct default',
    route: 'direct',
    why: 'Use this when the configured model is already the right tool.',
    model: { model: '<configured default model>' },
    localTools: true,
    worktree: false,
    verification: ['normal Karl status/history receipt'],
    tradeoff: 'Fastest familiar path, least routing intelligence.',
  },
};

function option(kind: RouteKind, id: string): RunOption {
  return { id, ...OPTIONS[kind] };
}

function orderFor(intent: Intent): RouteKind[] {
  switch (intent) {
    case 'code':
      return ['coder', 'direct', 'panel', 'cheap'];
    case 'review':
      return ['panel', 'direct', 'cheap', 'bodyplan'];
    case 'compare':
      return ['panel', 'bodyplan', 'direct', 'cheap'];
    case 'experiment':
      return ['bodyplan', 'panel', 'direct', 'cheap'];
    case 'ideation':
      return ['cheap', 'panel', 'direct', 'bodyplan'];
  }
}

export function buildRunCard(task: string): RunCard {
  const interpreted = interpretTask(task);
  const options = orderFor(interpreted.intent).map((kind, index) => option(kind, String(index + 1)));
  return {
    task,
    interpretation: interpreted.interpretation,
    intent: interpreted.intent,
    risk: interpreted.risk,
    recommendedId: '1',
    options,
  };
}

export function createState(scenarioIndex = 0): BrokerState {
  const task = SCENARIOS[scenarioIndex];
  const card = buildRunCard(task);
  return {
    phase: 'planning',
    task,
    scenarioIndex,
    card,
    selectedId: card.recommendedId,
    autoAccept: false,
  };
}

export function selectedOption(state: BrokerState): RunOption {
  return state.card.options.find((entry) => entry.id === state.selectedId) ?? state.card.options[0];
}

export function reduce(state: BrokerState, action: BrokerAction): BrokerState {
  switch (action.type) {
    case 'cycleScenario': {
      const nextIndex = (state.scenarioIndex + action.direction + SCENARIOS.length) % SCENARIOS.length;
      return createState(nextIndex);
    }
    case 'select':
      if (!state.card.options.some((entry) => entry.id === action.id)) {
        return state;
      }
      return { ...state, phase: 'selected', selectedId: action.id, receipt: undefined };
    case 'toggleAuto':
      return { ...state, autoAccept: !state.autoAccept };
    case 'execute': {
      const selected = selectedOption(state);
      return {
        ...state,
        phase: 'executed',
        receipt: {
          selected,
          decision: `Would execute "${selected.label}" for a ${state.card.intent} task.`,
          residualRisk: selected.worktree
            ? 'Caller still owns diff review and verification.'
            : 'Caller still owns answer quality and escalation choice.',
        },
      };
    }
    case 'reset':
      return createState(state.scenarioIndex);
  }
}
