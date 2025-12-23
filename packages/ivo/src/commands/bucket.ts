/**
 * Bucket Command - Interactive bucket filler for context slicing
 */

import type { Command } from 'commander';
import { createInterface } from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import type { IvoBackend } from '../backends/types.js';
import type { OutputFormat } from '../types.js';
import type { SliceIntensity, SliceStrategy, SliceStrategyCaps, SlicePlan, SliceRequest } from '../slicer/types.js';
import { CANDIDATE_SORT, createSlicerEngine, rankCandidates } from '../slicer/engine.js';
import { formatContext } from '../output/index.js';
import { runBucketTui } from '../ui/bucket.js';
import { loadHistoryContext } from '../history.js';

const DEFAULT_BUDGET = 32000;

const DEFAULT_STRATEGIES: Record<SliceIntensity, SliceStrategy[]> = {
  lite: ['inventory', 'keyword', 'config'],
  standard: ['inventory', 'keyword', 'symbols', 'config', 'diff'],
  deep: ['inventory', 'keyword', 'symbols', 'config', 'diff', 'ast', 'complexity', 'docs'],
};

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

export function registerBucketCommand(program: Command, getBackend: () => Promise<IvoBackend>): void {
  program
    .command('bucket [task]')
    .alias('fill')
    .description('Interactively fill a context bucket with selectable strategies')
    .option('-b, --budget <n>', 'Token budget limit', parseInt)
    .option('-i, --intensity <level>', 'Intensity: lite, standard, deep', 'standard')
    .option('-s, --strategies <list>', 'Comma-separated strategies to include')
    .option('--format <format>', 'Output format: xml, markdown, or json', 'xml')
    .option('--strategy-max-items <spec>', 'Per-strategy max items (e.g. keyword=20,docs=5)')
    .option('--strategy-max-tokens <spec>', 'Per-strategy max tokens (e.g. keyword=2000,docs=1200)')
    .option('--tree', 'Include a tree overview in the output')
    .option('--json', 'Output plan + selection JSON for UI consumption')
    .option('--ui', 'Run an interactive bucket UI loop')
    .option('--no-interactive', 'Disable interactive prompts')
    .addHelpText(
      'after',
      `
Examples:
  # Interactive bucket fill (prompts for options)
  ivo bucket "Fix auth timeout"

  # Non-interactive with explicit strategies
  ivo bucket "Refactor utils" --budget 32000 --strategies keyword,symbols

  # Include tree output
  ivo bucket "Review security" --tree

  # Emit plan + selection JSON
  ivo bucket "Audit auth" --json

  # Use the interactive UI loop
  ivo bucket "Optimize context" --ui
`
    )
    .action(async (task: string | undefined, options) => {
      try {
        const backend = await getBackend();
        const engine = createSlicerEngine(backend);

        let budget = Number.isFinite(options.budget) ? options.budget : DEFAULT_BUDGET;
        let intensity = normalizeIntensity(options.intensity as SliceIntensity);
        let strategies = parseStrategies(options.strategies, intensity);
        let includeTree = Boolean(options.tree);
        let strategyIntensity: Partial<Record<SliceStrategy, SliceIntensity>> | undefined;
        let strategyCaps = parseStrategyCaps(options.strategyMaxItems, options.strategyMaxTokens);
        const strategiesLocked = Boolean(options.strategies);
        const allowInteractive = options.interactive !== false;
        const useUi = Boolean(options.ui);

        if (allowInteractive && !useUi) {
          const prompt = createInterface({ input, output });

          if (!task) {
            task = await prompt.question('Task: ');
          }

          const budgetInput = await prompt.question(`Budget tokens [${budget}]: `);
          if (budgetInput.trim()) {
            const parsed = parseInt(budgetInput.trim(), 10);
            if (!Number.isNaN(parsed)) budget = parsed;
          }

          const intensityInput = await prompt.question(
            `Intensity (lite/standard/deep) [${intensity}]: `
          );
          if (intensityInput.trim()) {
            intensity = normalizeIntensity(intensityInput.trim() as SliceIntensity);
            if (!strategiesLocked) {
              strategies = DEFAULT_STRATEGIES[intensity];
            }
          }

          const strategyList = await prompt.question(
            `Strategies (${AVAILABLE_STRATEGIES.join(', ')}) [${strategies.join(', ')}]: `
          );
          if (strategyList.trim()) {
            strategies = parseStrategyList(strategyList);
          }

          const overrides = await prompt.question(
            'Strategy intensity overrides (e.g., keyword=deep,symbols=lite) [none]: '
          );
          if (overrides.trim()) {
            strategyIntensity = parseStrategyIntensity(overrides);
          }

          const capItems = await prompt.question(
            'Strategy max items (e.g., keyword=20,docs=5) [none]: '
          );
          if (capItems.trim()) {
            strategyCaps = mergeCaps(strategyCaps, parseStrategyCaps(capItems, undefined));
          }

          const capTokens = await prompt.question(
            'Strategy max tokens (e.g., keyword=2000,docs=1200) [none]: '
          );
          if (capTokens.trim()) {
            strategyCaps = mergeCaps(strategyCaps, parseStrategyCaps(undefined, capTokens));
          }

          const treeInput = await prompt.question(`Include tree? (y/N) [${includeTree ? 'y' : 'n'}]: `);
          if (treeInput.trim()) {
            includeTree = /^y(es)?$/i.test(treeInput.trim());
          }

          prompt.close();
        }

        if (!task || !task.trim()) {
          if (!useUi) {
            console.error('Error: Task is required for bucket filling.');
            process.exit(1);
          }
          task = '';
        }

        const request = {
          task: (task ?? '').trim(),
          repoRoot: process.cwd(),
          budgetTokens: budget,
          intensity,
          strategies,
          includeTree,
          strategyIntensity,
          strategyCaps,
        };

        let plan: SlicePlan;
        let outputFormat = options.format as OutputFormat;
        let includePreviousResponse = false;

        if (useUi) {
          const tuiResult = await runBucketTui(engine, request, {
            strategiesLocked,
            initialFormat: outputFormat,
          });
          if (!tuiResult) {
            console.error('Aborted.');
            process.exit(0);
          }
          plan = tuiResult.plan;
          outputFormat = tuiResult.format;
          includePreviousResponse = tuiResult.includePreviousResponse;
        } else {
          plan = await engine.plan(request);
        }

        if (allowInteractive && !useUi) {
          printPlanSummary(plan);
          const confirm = await confirmProceed();
          if (!confirm) {
            console.error('Aborted.');
            process.exit(0);
          }
        }

        const result = await engine.assemble(plan, budget);
        if (includePreviousResponse && !options.json) {
          try {
            const history = await loadHistoryContext({ limit: 1, full: true }, process.cwd());
            if (history) {
              result.context.history = history;
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`History unavailable: ${message}`);
          }
        }
        if (options.json) {
          const orderedCandidates = rankCandidates(plan);
          const payload = {
            sorting: CANDIDATE_SORT,
            plan: {
              request: plan.request,
              totals: plan.strategyTotals,
              warnings: plan.warnings,
              totalTokens: plan.totalTokens,
              tree: plan.tree,
              candidates: orderedCandidates,
            },
            result: {
              selected: result.selected,
              totalTokens: result.totalTokens,
              budgetTokens: result.budgetTokens,
              remainingTokens: Math.max(0, result.budgetTokens - result.totalTokens),
            },
          };
          console.log(JSON.stringify(payload, null, 2));
        } else {
          const outputText = formatContext(result.context, outputFormat);
          console.log(outputText);
        }
      } catch (error) {
        if (error instanceof Error) {
          console.error(`Error: ${error.message}`);
          process.exit(1);
        }
        throw error;
      }
    });
}

function normalizeIntensity(intensity: SliceIntensity): SliceIntensity {
  if (intensity === 'lite' || intensity === 'deep') return intensity;
  return 'standard';
}

function parseStrategies(input: string | undefined, intensity: SliceIntensity): SliceStrategy[] {
  if (!input) return DEFAULT_STRATEGIES[intensity];
  return parseStrategyList(input);
}

function parseStrategyList(input: string): SliceStrategy[] {
  const items = input
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return items.filter((item) => AVAILABLE_STRATEGIES.includes(item as SliceStrategy)) as SliceStrategy[];
}

function parseStrategyIntensity(input: string): Partial<Record<SliceStrategy, SliceIntensity>> {
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

  return result;
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

function printPlanSummary(plan: SlicePlan): void {
  console.error('');
  const budget = plan.request.budgetTokens ?? DEFAULT_BUDGET;
  const usage = budget > 0 ? ((plan.totalTokens / budget) * 100).toFixed(1) : '0.0';
  const intensity = plan.request.intensity ?? 'standard';
  console.error(
    `Bucket plan summary: ${formatTokens(plan.totalTokens)} / ${formatTokens(budget)} tokens (${usage}%), intensity: ${intensity}`
  );
  const strategies = plan.request.strategies?.length ? plan.request.strategies.join(', ') : 'none';
  const treeStatus = plan.request.includeTree ? 'on' : 'off';
  console.error(`Settings: strategies: ${strategies}; tree: ${treeStatus}`);
  for (const [strategy, stats] of Object.entries(plan.strategyTotals)) {
    const caps = plan.request.strategyCaps?.[strategy as SliceStrategy];
    const itemsCap = formatCapItems(caps?.maxItems);
    const tokensCap = formatCapTokens(caps?.maxTokens);
    console.error(
      `  ${strategy}: items ${stats.count} / ${itemsCap}, tokens ${formatTokens(stats.tokens)} / ${tokensCap}`
    );
  }
  if (plan.tree) {
    console.error(`  tree: ${formatTokens(plan.tree.tokens)} tokens`);
  }
  if (plan.warnings.length) {
    console.error('Warnings:');
    for (const warning of plan.warnings) {
      console.error(`  - ${warning}`);
    }
  }
  console.error('');
}

function formatCapTokens(value?: number): string {
  if (!value || value <= 0) return 'uncapped';
  return formatTokens(value);
}

function formatCapItems(value?: number): string {
  if (!value || value <= 0) return 'uncapped';
  return String(value);
}

async function confirmProceed(): Promise<boolean> {
  const prompt = createInterface({ input, output });
  const answer = await prompt.question('Proceed with this plan? (y/N): ');
  prompt.close();
  return /^y(es)?$/i.test(answer.trim());
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  return String(tokens);
}
