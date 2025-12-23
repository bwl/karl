/**
 * Bucket TUI - full screen bucket filler UI
 */

import blessed from 'neo-blessed';
import type { OutputFormat } from '../types.js';
import type { SliceIntensity, SlicePlan, SliceRequest, SliceStrategy, SliceStrategyCaps } from '../slicer/types.js';
import type { SlicerEngine } from '../slicer/engine.js';
import { formatContext } from '../output/index.js';
import { suggestBucketConfig, type BucketSuggestionUpdate } from '../slicer/suggest.js';
import { loadHistoryContext } from '../history.js';

const AVAILABLE_STRATEGIES: SliceStrategy[] = [
  'inventory',
  'keyword',
  'symbols',
  'config',
  'diff',
  'ast',
  'complexity',
  'docs',
];

const DEFAULT_STRATEGIES: Record<SliceIntensity, SliceStrategy[]> = {
  lite: ['inventory', 'keyword', 'config'],
  standard: ['inventory', 'keyword', 'symbols', 'config', 'diff'],
  deep: ['inventory', 'keyword', 'symbols', 'config', 'diff', 'ast', 'complexity', 'docs'],
};

const STRATEGY_HELP: Record<SliceStrategy, string> = {
  inventory: 'Inventory: quick file list snapshot (paths + sizes).',
  keyword: 'Keyword: search task terms in file content.',
  symbols: 'Symbols: scan for identifiers matching task.',
  config: 'Config: pick relevant config/build/env files.',
  diff: 'Diff: include recent changes (git).',
  ast: 'AST: codemap/structure for task-relevant files.',
  complexity: 'Complexity: include large/complex code files.',
  docs: 'Docs: include README/spec/status docs.',
  explicit: 'Explicit: include manually chosen files.',
};

export interface BucketTuiResult {
  plan: SlicePlan;
  format: OutputFormat;
  includePreviousResponse: boolean;
}

export interface BucketTuiOptions {
  strategiesLocked: boolean;
  initialFormat: OutputFormat;
}

export async function runBucketTui(
  engine: SlicerEngine,
  initialRequest: SliceRequest,
  options: BucketTuiOptions
): Promise<BucketTuiResult | null> {
  return new Promise((resolve) => {
    const screen = blessed.screen({
      smartCSR: true,
      title: 'Ivo Bucket',
    });

    const statusBar = blessed.box({
      parent: screen,
      top: 0,
      left: 0,
      height: 1,
      width: '100%',
      style: { inverse: true },
    });

    const rightPane = blessed.box({
      parent: screen,
      top: 1,
      left: '35%',
      width: '65%',
      height: '100%-2',
      border: 'line',
      label: 'Preview',
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      mouse: true,
    });

    const controlsList = blessed.list({
      parent: screen,
      top: 1,
      left: 0,
      width: '35%',
      height: '100%-2',
      border: 'line',
      label: 'Controls',
      keys: true,
      mouse: true,
      vi: true,
      style: {
        selected: { inverse: true },
      },
    });

    const helpBar = blessed.box({
      parent: screen,
      bottom: 0,
      left: 0,
      height: 1,
      width: '100%',
    });

    const prompt = blessed.prompt({
      parent: screen,
      border: 'line',
      height: 7,
      width: '50%',
      top: 'center',
      left: 'center',
      label: 'Input',
      keys: true,
      vi: true,
    });

    let request: SliceRequest = { ...initialRequest };
    let outputFormat = options.initialFormat;
    let autoRefresh = true;
    let refreshing = false;
    let currentPlan: SlicePlan | null = null;
    let refreshTimer: NodeJS.Timeout | null = null;
    let hasFocusPreview = false;
    let includePreviousResponse = false;

    const focusables = [controlsList, rightPane];
    let focusIndex = 0;

    type ControlRow =
      | { type: 'header'; label: string }
      | { type: 'strategy'; strategy: SliceStrategy }
      | { type: 'setting'; index: number };

    let controlRows: ControlRow[] = [];

    const configItems: Array<{
      key: string;
      label: string;
      help: string;
      getValue: () => string;
      onEdit: () => Promise<void>;
    }> = [
      {
        key: 'task',
        label: 'Task',
        help: 'Task: Enter to edit the slicing prompt used for ranking.',
        getValue: () => formatTask(request.task),
        onEdit: async () => {
          const value = await promptInput(prompt, 'Task', request.task ?? '');
          if (value === null) return;
          request.task = value.trim();
          scheduleRefresh();
        },
      },
      {
        key: 'budget',
        label: 'Budget tokens',
        help: 'Budget: Enter to set max tokens for the bucket.',
        getValue: () => String(request.budgetTokens ?? ''),
        onEdit: async () => {
          const value = await promptInput(prompt, 'Budget tokens', String(request.budgetTokens ?? ''));
          const parsed = parseInt(value ?? '', 10);
          if (!Number.isNaN(parsed) && parsed > 0) {
            request.budgetTokens = parsed;
            scheduleRefresh();
          }
        },
      },
      {
        key: 'intensity',
        label: 'Intensity',
        help: 'Intensity: Enter to set lite, standard, or deep defaults.',
        getValue: () => request.intensity ?? 'standard',
        onEdit: async () => {
          const value = await promptInput(prompt, 'Intensity (lite/standard/deep)', request.intensity ?? 'standard');
          if (!value) return;
          request.intensity = normalizeIntensity(value.trim() as SliceIntensity);
          if (!options.strategiesLocked) {
            request.strategies = DEFAULT_STRATEGIES[request.intensity];
          }
          scheduleRefresh();
        },
      },
      {
        key: 'format',
        label: 'Format',
        help: 'Format: Enter to set xml, markdown, or json output.',
        getValue: () => outputFormat,
        onEdit: async () => {
          const value = await promptInput(prompt, 'Format (xml/markdown/json)', outputFormat);
          if (!value) return;
          const next = normalizeFormat(value.trim());
          if (next) {
            outputFormat = next;
            scheduleRefresh();
          }
        },
      },
      {
        key: 'tree',
        label: 'Tree',
        help: 'Tree: Enter to toggle tree overview in the output.',
        getValue: () => (request.includeTree ? 'on' : 'off'),
        onEdit: async () => {
          request.includeTree = !request.includeTree;
          scheduleRefresh();
        },
      },
      {
        key: 'previous-response',
        label: 'Previous response',
        help: 'Previous response: Enter to include the latest Karl response.',
        getValue: () => (includePreviousResponse ? 'on' : 'off'),
        onEdit: async () => {
          includePreviousResponse = !includePreviousResponse;
          scheduleRefresh();
        },
      },
      {
        key: 'caps-items',
        label: 'Caps (items)',
        help: 'Caps (items): Enter to set per-strategy max item counts.',
        getValue: () => formatCaps(request.strategyCaps, 'maxItems'),
        onEdit: async () => {
          const value = await promptInput(prompt, 'Strategy max items (keyword=20,docs=5)', '');
          if (!value) return;
          request.strategyCaps = mergeCaps(request.strategyCaps, parseStrategyCaps(value, undefined));
          scheduleRefresh();
        },
      },
      {
        key: 'caps-tokens',
        label: 'Caps (tokens)',
        help: 'Caps (tokens): Enter to set per-strategy max token counts.',
        getValue: () => formatCaps(request.strategyCaps, 'maxTokens'),
        onEdit: async () => {
          const value = await promptInput(prompt, 'Strategy max tokens (keyword=2000,docs=1200)', '');
          if (!value) return;
          request.strategyCaps = mergeCaps(request.strategyCaps, parseStrategyCaps(undefined, value));
          scheduleRefresh();
        },
      },
      {
        key: 'overrides',
        label: 'Overrides',
        help: 'Overrides: Enter to set per-strategy intensities.',
        getValue: () => formatOverrides(request.strategyIntensity),
        onEdit: async () => {
          const value = await promptInput(prompt, 'Overrides (keyword=deep,symbols=lite)', '');
          if (!value) return;
          request.strategyIntensity = parseStrategyIntensity(value);
          scheduleRefresh();
        },
      },
      {
        key: 'include',
        label: 'Include globs',
        help: 'Include globs: Enter to filter to these file globs.',
        getValue: () => formatList(request.include),
        onEdit: async () => {
          const value = await promptInput(prompt, 'Include globs (comma-separated)', formatList(request.include));
          if (value === null) return;
          request.include = parseList(value);
          scheduleRefresh();
        },
      },
      {
        key: 'exclude',
        label: 'Exclude globs',
        help: 'Exclude globs: Enter to remove these file globs.',
        getValue: () => formatList(request.exclude),
        onEdit: async () => {
          const value = await promptInput(prompt, 'Exclude globs (comma-separated)', formatList(request.exclude));
          if (value === null) return;
          request.exclude = parseList(value);
          scheduleRefresh();
        },
      },
      {
        key: 'auto',
        label: 'Auto refresh',
        help: 'Auto refresh: Enter to toggle auto planning.',
        getValue: () => (autoRefresh ? 'on' : 'off'),
        onEdit: async () => {
          autoRefresh = !autoRefresh;
          updateStatus('Auto refresh toggled');
        },
      },
    ];

    function renderControlsList(plan?: SlicePlan): void {
      const rows: ControlRow[] = [];
      const items: string[] = [];

      rows.push({ type: 'header', label: 'Strategies' });
      items.push('-- Strategies --');

      const active = new Set(request.strategies ?? []);
      for (const strategy of AVAILABLE_STRATEGIES) {
        const checked = active.has(strategy) ? '[x]' : '[ ]';
        const stats = plan?.strategyTotals?.[strategy];
        const caps = request.strategyCaps?.[strategy];
        const itemsCap = formatCapItems(caps?.maxItems);
        const tokensCap = formatCapTokens(caps?.maxTokens);
        const detail = stats
          ? ` (${stats.count}/${itemsCap} | ${formatTokens(stats.tokens)}/${tokensCap})`
          : '';
        rows.push({ type: 'strategy', strategy });
        items.push(`  ${checked} ${strategy}${detail}`);
      }

      rows.push({ type: 'header', label: 'Settings' });
      items.push('-- Settings --');
      configItems.forEach((item, index) => {
        rows.push({ type: 'setting', index });
        items.push(`  ${item.label}: ${item.getValue() || 'none'}`);
      });

      controlRows = rows;
      controlsList.setItems(items);
      controlsList.select(Math.min(controlsList.selected ?? 0, items.length - 1));
    }

    function updatePreview(plan: SlicePlan): void {
      engine
        .assemble(plan, request.budgetTokens)
        .then(async (result) => {
          if (includePreviousResponse) {
            try {
              const history = await loadHistoryContext({ limit: 1, full: true }, request.repoRoot || process.cwd());
              if (history) {
                result.context.history = history;
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              updateStatus(`History unavailable: ${message}`);
            }
          }
          const content = formatContext(result.context, outputFormat);
          rightPane.setContent(content);
          const budget = request.budgetTokens ?? 0;
          const usage = budget > 0 ? ((result.totalTokens / budget) * 100).toFixed(1) : '0.0';
          updateStatus(`Tokens ${formatTokens(result.totalTokens)} / ${formatTokens(budget)} (${usage}%)`);
          screen.render();
        })
        .catch((error) => {
          updateStatus(`Preview error: ${error.message}`);
        });
    }

    function updateStatus(message: string): void {
      statusBar.setContent(
        `${message} | format: ${outputFormat} | auto: ${autoRefresh ? 'on' : 'off'} | tab: focus | g: suggest | s: save | q: quit | ?: help`
      );
    }

    function updateHelp(): void {
      if (focusables[focusIndex] === rightPane) {
        helpBar.setContent('Preview: scroll with arrows/PageUp/PageDown, Tab to Controls');
        return;
      }
      const row = controlRows[controlsList.selected ?? 0];
      if (!row) {
        helpBar.setContent('Controls: select a row with arrows, Enter to edit');
        return;
      }
      if (row.type === 'header') {
        helpBar.setContent('Controls: select a row with arrows, Space/Enter to toggle or edit');
        return;
      }
      if (row.type === 'strategy') {
        const locked = options.strategiesLocked ? ' (locked by CLI options)' : '';
        const detail = STRATEGY_HELP[row.strategy] ?? 'Strategy: Space/Enter to toggle.';
        helpBar.setContent(`${detail} Space/Enter to toggle${locked}`);
        return;
      }
      if (row.type === 'setting') {
        const item = configItems[row.index];
        helpBar.setContent(item?.help ?? 'Setting: Enter to edit');
      }
    }

    async function refresh(): Promise<void> {
      if (refreshing) return;
      refreshing = true;
      updateStatus('Refreshing...');
      screen.render();
      try {
        const plan = await engine.plan(request);
        currentPlan = plan;
        renderControlsList(plan);
        updatePreview(plan);
      } catch (error) {
        updateStatus(`Refresh error: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        refreshing = false;
      }
    }

    function scheduleRefresh(): void {
      if (!autoRefresh) return;
      if (refreshTimer) {
        clearTimeout(refreshTimer);
      }
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        void refresh();
      }, 200);
    }

    function toggleStrategy(strategy: SliceStrategy): void {
      if (options.strategiesLocked) {
        updateStatus('Strategies locked by CLI options');
        screen.render();
        return;
      }
      const current = new Set(request.strategies ?? []);
      if (current.has(strategy)) {
        current.delete(strategy);
      } else {
        current.add(strategy);
      }
      request.strategies = AVAILABLE_STRATEGIES.filter((item) => current.has(item));
      scheduleRefresh();
    }

    screen.key(['tab'], () => {
      focusIndex = (focusIndex + 1) % focusables.length;
      focusables[focusIndex].focus();
      hasFocusPreview = focusables[focusIndex] === rightPane;
      updateHelp();
      screen.render();
    });

    screen.key(['S-tab'], () => {
      focusIndex = (focusIndex - 1 + focusables.length) % focusables.length;
      focusables[focusIndex].focus();
      hasFocusPreview = focusables[focusIndex] === rightPane;
      updateHelp();
      screen.render();
    });

    screen.key(['q', 'C-c'], () => {
      screen.destroy();
      resolve(null);
    });

    screen.key(['s'], () => {
      if (!currentPlan) return;
      screen.destroy();
      resolve({ plan: currentPlan, format: outputFormat, includePreviousResponse });
    });

    screen.key(['?'], () => {
      const help = blessed.message({
        parent: screen,
        border: 'line',
        width: '60%',
        height: 10,
        top: 'center',
        left: 'center',
        label: 'Help',
      });
      help.display(
        'Tab: next pane | Shift+Tab: prev pane\n' +
          'Space: toggle strategy (when focused)\n' +
          'Enter: edit setting (when focused)\n' +
          'r: refresh now | a: toggle auto refresh\n' +
          'p: cycle format | g: suggest config\n' +
          's: save & exit | q: quit',
        () => {
          screen.render();
        }
      );
    });

    screen.key(['r'], () => {
      void refresh();
    });

    screen.key(['a'], () => {
      autoRefresh = !autoRefresh;
      updateStatus(`Auto refresh: ${autoRefresh ? 'on' : 'off'}`);
      renderControlsList(currentPlan ?? undefined);
      updateHelp();
      screen.render();
    });

    screen.key(['p'], () => {
      outputFormat = cycleFormat(outputFormat);
      renderControlsList(currentPlan ?? undefined);
      updateHelp();
      scheduleRefresh();
    });

    screen.key(['g'], () => {
      void generateSuggestion();
    });

    const updateHelpAndRender = () => {
      updateHelp();
      screen.render();
    };

    controlsList.on('select', updateHelpAndRender);
    controlsList.on('select item', updateHelpAndRender);
    controlsList.on('click', updateHelpAndRender);
    controlsList.on('keypress', (_ch: string, key: { name?: string }) => {
      if (!key?.name) return;
      if (['up', 'down', 'pageup', 'pagedown', 'home', 'end'].includes(key.name)) {
        updateHelpAndRender();
      }
    });

    controlsList.key('space', () => {
      const row = controlRows[controlsList.selected ?? 0];
      if (row?.type === 'strategy') {
        toggleStrategy(row.strategy);
      }
    });

    controlsList.key('enter', async () => {
      const row = controlRows[controlsList.selected ?? 0];
      if (row?.type === 'strategy') {
        toggleStrategy(row.strategy);
        return;
      }
      if (row?.type === 'setting') {
        const item = configItems[row.index];
        if (!item) return;
        await item.onEdit();
        renderControlsList(currentPlan ?? undefined);
        screen.render();
      }
    });

    rightPane.on('focus', () => {
      hasFocusPreview = true;
      updateHelp();
    });

    rightPane.on('blur', () => {
      hasFocusPreview = false;
      updateHelp();
    });

    rightPane.key(['up', 'down', 'pageup', 'pagedown', 'home', 'end'], (_ch: string, key: { name?: string }) => {
      if (!hasFocusPreview) return;
      switch (key.name) {
        case 'up':
          rightPane.scroll(-1);
          break;
        case 'down':
          rightPane.scroll(1);
          break;
        case 'pageup':
          rightPane.scroll(-10);
          break;
        case 'pagedown':
          rightPane.scroll(10);
          break;
        case 'home':
          rightPane.scrollTo(0);
          break;
        case 'end':
          rightPane.scrollTo(rightPane.getScrollHeight());
          break;
      }
      screen.render();
    });

    renderControlsList();
    updateHelp();
    focusables[focusIndex].focus();
    void refresh();
    screen.render();

    async function generateSuggestion(): Promise<void> {
      if (!request.task?.trim()) {
        updateStatus('Add a task before suggesting a config.');
        screen.render();
        return;
      }

      updateStatus('Generating suggestion...');
      screen.render();

      try {
        const result = await suggestBucketConfig(request, {
          plan: currentPlan ?? undefined,
          strategiesLocked: options.strategiesLocked,
          includePreviousResponse,
        });
        applySuggestion(result.update);
        const note = result.note ? `Suggestion: ${result.note}` : `Suggestion applied (${result.stackName} stack)`;
        updateStatus(note);
        renderControlsList(currentPlan ?? undefined);
        updateHelp();
        await refresh();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateStatus(`Suggestion failed: ${message}`);
        screen.render();
      }
    }

    function applySuggestion(update: BucketSuggestionUpdate): void {
      if (update.intensity) {
        request.intensity = update.intensity;
      }
      if (update.strategies && !options.strategiesLocked) {
        request.strategies = update.strategies;
      }
      if (update.includeTree !== undefined) {
        request.includeTree = update.includeTree;
      }
      if (update.include !== undefined) {
        request.include = update.include;
      }
      if (update.exclude !== undefined) {
        request.exclude = update.exclude;
      }
      if (update.strategyIntensity !== undefined) {
        request.strategyIntensity = update.strategyIntensity;
      }
      if (update.strategyCaps !== undefined) {
        request.strategyCaps = update.strategyCaps;
      }
      if (update.includePreviousResponse !== undefined) {
        includePreviousResponse = update.includePreviousResponse;
      }
    }
  });
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  return String(tokens);
}

function formatCapTokens(value?: number): string {
  if (!value || value <= 0) return 'uncapped';
  return formatTokens(value);
}

function formatCapItems(value?: number): string {
  if (!value || value <= 0) return 'uncapped';
  return String(value);
}

function formatTask(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const max = 48;
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 3)}...`;
}

function normalizeIntensity(intensity: SliceIntensity): SliceIntensity {
  if (intensity === 'lite' || intensity === 'deep') return intensity;
  return 'standard';
}

function normalizeFormat(value: string): OutputFormat | null {
  if (value === 'xml' || value === 'markdown' || value === 'json') return value;
  return null;
}

function cycleFormat(current: OutputFormat): OutputFormat {
  switch (current) {
    case 'xml':
      return 'markdown';
    case 'markdown':
      return 'json';
    case 'json':
    default:
      return 'xml';
  }
}

function formatList(values?: string[]): string {
  if (!values?.length) return 'none';
  return values.join(',');
}

function parseList(value: string): string[] | undefined {
  const list = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return list.length ? list : undefined;
}

function formatCaps(
  caps: Partial<Record<SliceStrategy, SliceStrategyCaps>> | undefined,
  key: keyof SliceStrategyCaps
): string {
  if (!caps) return 'none';
  const entries: string[] = [];
  for (const [strategy, value] of Object.entries(caps)) {
    const amount = value?.[key];
    if (!amount) continue;
    entries.push(`${strategy}=${amount}`);
  }
  return entries.length ? entries.join(',') : 'none';
}

function formatOverrides(overrides: Partial<Record<SliceStrategy, SliceIntensity>> | undefined): string {
  if (!overrides) return 'none';
  const entries: string[] = [];
  for (const [strategy, value] of Object.entries(overrides)) {
    if (!value) continue;
    entries.push(`${strategy}=${value}`);
  }
  return entries.length ? entries.join(',') : 'none';
}

function parseStrategyIntensity(input: string): Partial<Record<SliceStrategy, SliceIntensity>> | undefined {
  const entries = input
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const result: Partial<Record<SliceStrategy, SliceIntensity>> = {};

  for (const entry of entries) {
    const [strategy, intensity] = entry.split('=').map((value) => value.trim());
    if (!strategy || !intensity) continue;
    if (!AVAILABLE_STRATEGIES.includes(strategy as SliceStrategy)) continue;
    if (intensity !== 'lite' && intensity !== 'standard' && intensity !== 'deep') continue;
    result[strategy as SliceStrategy] = intensity as SliceIntensity;
  }

  return Object.keys(result).length ? result : undefined;
}

function parseStrategyCaps(
  maxItemsSpec?: string,
  maxTokensSpec?: string
): Partial<Record<SliceStrategy, SliceStrategyCaps>> | undefined {
  const result: Partial<Record<SliceStrategy, SliceStrategyCaps>> = {};

  const applySpec = (spec: string | undefined, key: keyof SliceStrategyCaps) => {
    if (!spec) return;
    const entries = spec
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    for (const entry of entries) {
      const [strategy, valueRaw] = entry.split('=').map((value) => value.trim());
      if (!strategy || !valueRaw) continue;
      if (!AVAILABLE_STRATEGIES.includes(strategy as SliceStrategy)) continue;
      const value = parseInt(valueRaw, 10);
      if (Number.isNaN(value) || value <= 0) continue;

      const current = result[strategy as SliceStrategy] ?? {};
      current[key] = value;
      result[strategy as SliceStrategy] = current;
    }
  };

  applySpec(maxItemsSpec, 'maxItems');
  applySpec(maxTokensSpec, 'maxTokens');

  return Object.keys(result).length ? result : undefined;
}

function mergeCaps(
  base: Partial<Record<SliceStrategy, SliceStrategyCaps>> | undefined,
  next: Partial<Record<SliceStrategy, SliceStrategyCaps>> | undefined
): Partial<Record<SliceStrategy, SliceStrategyCaps>> | undefined {
  if (!base) return next;
  if (!next) return base;

  const merged: Partial<Record<SliceStrategy, SliceStrategyCaps>> = { ...base };
  for (const [strategy, caps] of Object.entries(next)) {
    const key = strategy as SliceStrategy;
    merged[key] = { ...merged[key], ...caps };
  }

  return merged;
}

type PromptLike = {
  input: (label: string, initial: string, cb: (error: unknown, value?: string) => void) => void;
};

async function promptInput(prompt: PromptLike, label: string, initial: string): Promise<string | null> {
  return new Promise((resolve) => {
    prompt.input(label, initial, (error: unknown, value?: string) => {
      if (error) {
        resolve(null);
        return;
      }
      resolve(value ?? null);
    });
  });
}
