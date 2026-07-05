export type BrokerIntent = 'code' | 'review' | 'ideation' | 'compare' | 'experiment';
export type BrokerRisk = 'low' | 'medium' | 'high';
export type RouteKind = 'coder' | 'panel' | 'cheap' | 'bodyplan' | 'direct';

export interface RouteModel {
  provider?: string;
  model: string;
  request?: Record<string, unknown>;
}

export interface RouteAvailability {
  available: boolean;
  requirements: string[];
}

export interface RunRoute {
  id: string;
  label: string;
  route: RouteKind;
  why: string;
  model: RouteModel;
  localTools: boolean;
  worktree: boolean;
  verification: string[];
  tradeoff: string;
  availability: RouteAvailability;
  execution: {
    mode: 'karl-run' | 'karl-magic' | 'route-only';
    argv: string[];
    notes: string[];
  };
}

export interface RunPlan {
  kind: 'karl.runPlan';
  version: 1;
  task: string;
  cwd: string;
  interpretation: {
    intent: BrokerIntent;
    risk: BrokerRisk;
    summary: string;
  };
  recommendedRoute: RouteKind;
  recommended: RunRoute;
  alternatives: RunRoute[];
}

export interface RouteSelection {
  kind: 'karl.routeSelection';
  version: 1;
  task: string;
  cwd: string;
  selected: RunRoute;
  decision: string;
  residualRisk: string;
}

export interface BrokerContext {
  cwd: string;
  defaultModelLabel?: string;
  hasDefaultModel: boolean;
  openRouterConfigured: boolean;
  openRouterAuthenticated: boolean;
}

export interface BuildRunPlanOptions {
  task: string;
  context: BrokerContext;
  selectedRoute?: string;
}

const codeWords = /\b(implement|fix|debug|refactor|test|verifier|pipeline|build|code|patch|edit)\b/i;
const reviewWords = /\b(review|audit|risk|security|regression|diff|inspect)\b/i;
const compareWords = /\b(compare|options|approaches|tradeoff|which|argue|decide)\b/i;
const experimentWords = /\b(body|request bodies|multi-model|benchmark|experiment|matrix|router)\b/i;
const ideationWords = /\b(ideas|brainstorm|weird|names|sketch|cheap|no-tools|provocation)\b/i;

function interpretTask(task: string): { intent: BrokerIntent; risk: BrokerRisk; summary: string } {
  if (experimentWords.test(task)) {
    return {
      intent: 'experiment',
      risk: 'medium',
      summary: 'Model-routing experiment that benefits from generated request bodies.',
    };
  }
  if (codeWords.test(task)) {
    return {
      intent: 'code',
      risk: 'high',
      summary: 'Repo-editing implementation task with verification and isolation needs.',
    };
  }
  if (reviewWords.test(task)) {
    return {
      intent: 'review',
      risk: 'medium',
      summary: 'Read-heavy review task where local edits should stay off by default.',
    };
  }
  if (compareWords.test(task)) {
    return {
      intent: 'compare',
      risk: 'medium',
      summary: 'Decision-support task where a panel can expose disagreement.',
    };
  }
  if (ideationWords.test(task)) {
    return {
      intent: 'ideation',
      risk: 'low',
      summary: 'Low-risk no-tools ideation task where cost and speed matter.',
    };
  }
  return {
    intent: 'ideation',
    risk: 'low',
    summary: 'Unclear lightweight task; start cheap and escalate if needed.',
  };
}

function hashString(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'task';
}

function sessionId(context: BrokerContext, task: string): string {
  return `karl-${slug(context.cwd)}-${hashString(`${context.cwd}\n${task}`)}`;
}

function openRouterAvailability(context: BrokerContext): RouteAvailability {
  const requirements: string[] = [];
  if (!context.openRouterConfigured) {
    requirements.push('configure provider "openrouter"');
  }
  if (context.openRouterConfigured && !context.openRouterAuthenticated) {
    requirements.push('set OPENROUTER_API_KEY or provider apiKey');
  }
  return {
    available: requirements.length === 0,
    requirements,
  };
}

function directAvailability(context: BrokerContext): RouteAvailability {
  return {
    available: context.hasDefaultModel,
    requirements: context.hasDefaultModel ? [] : ['configure a default Karl model'],
  };
}

function argvQuote(value: string): string {
  return value;
}

function routeTemplates(context: BrokerContext, task: string): Record<RouteKind, Omit<RunRoute, 'id'>> {
  const openRouter = openRouterAvailability(context);
  const direct = directAvailability(context);
  const stickySession = sessionId(context, task);
  const defaultModel = context.defaultModelLabel ?? '<configured default model>';

  return {
    coder: {
      label: 'Worktree coder',
      route: 'coder',
      why: 'Use this when Karl should edit a repo and leave a gateable diff.',
      model: {
        provider: 'openrouter',
        model: 'openrouter/pareto-code',
        request: {
          plugins: [{ id: 'pareto-router', min_coding_score: 0.66 }],
          session_id: stickySession,
        },
      },
      localTools: true,
      worktree: true,
      verification: ['project typecheck', 'targeted tests from task context'],
      tradeoff: 'Highest setup cost, best containment.',
      availability: openRouter,
      execution: {
        mode: 'route-only',
        argv: ['karl', 'route', 'select', '--route', 'coder', argvQuote(task)],
        notes: [
          'Materializes an OpenRouter Pareto coding route.',
          'Actual model execution is intentionally left to the caller until route execution is wired.',
        ],
      },
    },
    panel: {
      label: 'Panel first',
      route: 'panel',
      why: 'Use this when disagreement is more useful than immediate action.',
      model: {
        provider: 'openrouter',
        model: 'openrouter/fusion',
        request: {
          plugins: [{ id: 'fusion' }],
          tool_choice: 'required',
        },
      },
      localTools: false,
      worktree: false,
      verification: ['caller reads options before execution'],
      tradeoff: 'Good judgment, no repo access unless followed by another route.',
      availability: openRouter,
      execution: {
        mode: 'route-only',
        argv: ['karl', 'route', 'select', '--route', 'panel', argvQuote(task)],
        notes: [
          'Use with local tools off so required tool choice resolves to Fusion.',
          'Follow with a coding route if the panel chooses an implementation path.',
        ],
      },
    },
    cheap: {
      label: 'Cheap sketch',
      route: 'cheap',
      why: 'Use this when a rough first pass is enough.',
      model: {
        provider: 'openrouter',
        model: 'openrouter/free',
      },
      localTools: false,
      worktree: false,
      verification: ['none; output is disposable'],
      tradeoff: 'Low cost, low guarantees.',
      availability: openRouter,
      execution: {
        mode: 'route-only',
        argv: ['karl', 'route', 'select', '--route', 'cheap', argvQuote(task)],
        notes: ['Good for low-stakes ideation or first-pass summaries.'],
      },
    },
    bodyplan: {
      label: 'Body-builder plan',
      route: 'bodyplan',
      why: 'Use this to generate candidate OpenRouter request bodies for experiments.',
      model: {
        provider: 'openrouter',
        model: 'openrouter/bodybuilder',
      },
      localTools: false,
      worktree: false,
      verification: ['Karl or caller validates generated request bodies before execution'],
      tradeoff: 'Meta-routing; useful before a batch, not for direct answers.',
      availability: openRouter,
      execution: {
        mode: 'route-only',
        argv: ['karl', 'route', 'select', '--route', 'bodyplan', argvQuote(task)],
        notes: ['Use when the task is to design an OpenRouter experiment.'],
      },
    },
    direct: {
      label: 'Direct default',
      route: 'direct',
      why: 'Use this when the configured model is already the right tool.',
      model: {
        model: defaultModel,
      },
      localTools: true,
      worktree: false,
      verification: ['normal Karl status/history receipt'],
      tradeoff: 'Fast familiar path, least routing intelligence.',
      availability: direct,
      execution: {
        mode: 'karl-run',
        argv: ['karl', 'run', argvQuote(task)],
        notes: ['Uses the configured default stack/model.'],
      },
    },
  };
}

function orderFor(intent: BrokerIntent): RouteKind[] {
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

function findRoute(routes: RunRoute[], selectedRoute?: string): RunRoute | null {
  if (!selectedRoute) {
    return null;
  }
  const normalized = selectedRoute.toLowerCase();
  return routes.find((route) =>
    route.id === normalized ||
    route.route === normalized ||
    route.label.toLowerCase() === normalized
  ) ?? null;
}

function firstAvailable(routes: RunRoute[]): RunRoute {
  return routes.find((route) => route.availability.available) ?? routes[0];
}

export function buildRunPlan(options: BuildRunPlanOptions): RunPlan {
  const interpreted = interpretTask(options.task);
  const templates = routeTemplates(options.context, options.task);
  const routes = orderFor(interpreted.intent).map((kind, index) => ({
    id: String(index + 1),
    ...templates[kind],
  }));
  const selected = findRoute(routes, options.selectedRoute) ?? firstAvailable(routes);

  return {
    kind: 'karl.runPlan',
    version: 1,
    task: options.task,
    cwd: options.context.cwd,
    interpretation: interpreted,
    recommendedRoute: selected.route,
    recommended: selected,
    alternatives: routes.filter((route) => route.id !== selected.id),
  };
}

export function selectRoute(plan: RunPlan, selectedRoute?: string): RouteSelection {
  const routes = [plan.recommended, ...plan.alternatives];
  const selected = findRoute(routes, selectedRoute) ?? plan.recommended;
  return {
    kind: 'karl.routeSelection',
    version: 1,
    task: plan.task,
    cwd: plan.cwd,
    selected,
    decision: `Selected "${selected.label}" for a ${plan.interpretation.intent} task.`,
    residualRisk: selected.worktree
      ? 'Caller still owns diff review and verification.'
      : 'Caller still owns answer quality, escalation, and any follow-up execution.',
  };
}
