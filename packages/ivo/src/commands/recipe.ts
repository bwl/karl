/**
 * Recipe Command - Save and run reusable context-building recipes
 */

import type { Command } from 'commander';
import type { IvoBackend } from '../backends/types.js';
import type { OutputFormat } from '../types.js';
import type { SliceIntensity, SliceStrategy } from '../slicer/types.js';
import { createSlicerEngine } from '../slicer/engine.js';
import { formatContext } from '../output/index.js';
import { saveContext } from '../context-store.js';
import { saveRecipe, loadRecipe, listRecipes, deleteRecipe, type Recipe } from '../recipe-store.js';

const AVAILABLE_STRATEGIES: SliceStrategy[] = [
  'inventory', 'skeleton', 'keyword', 'symbols', 'config',
  'diff', 'graph', 'ast', 'complexity', 'docs',
];

export function registerRecipeCommand(program: Command, getBackend: () => Promise<IvoBackend>): void {
  const recipe = program
    .command('recipe')
    .description('Manage reusable context-building recipes');

  recipe
    .command('save <name>')
    .description('Save a recipe from CLI flags')
    .option('-d, --description <text>', 'Recipe description')
    .option('-k, --keywords <keywords>', 'Default keywords')
    .option('-i, --intensity <level>', 'Intensity: lite, standard, deep')
    .option('-s, --strategies <list>', 'Comma-separated strategies')
    .option('-b, --budget <n>', 'Token budget', parseInt)
    .option('--include <patterns>', 'Comma-separated glob include patterns')
    .option('--exclude <patterns>', 'Comma-separated glob exclude patterns')
    .option('--pin', 'Pin resulting contexts (no auto-cleanup)')
    .option('-g, --global', 'Save as global recipe')
    .action(async (name: string, options) => {
      const now = new Date().toISOString();
      const data: Recipe = {
        name,
        createdAt: now,
      };

      if (options.description) data.description = options.description;
      if (options.keywords) data.keywords = options.keywords;
      if (options.intensity) {
        const i = options.intensity as SliceIntensity;
        if (i === 'lite' || i === 'standard' || i === 'deep') data.intensity = i;
      }
      if (options.strategies) {
        const list = options.strategies.split(',').map((s: string) => s.trim()).filter(Boolean);
        data.strategies = list.filter((s: string) =>
          AVAILABLE_STRATEGIES.includes(s as SliceStrategy)
        ) as SliceStrategy[];
      }
      if (Number.isFinite(options.budget)) data.budget = options.budget;
      if (options.include) data.include = options.include.split(',').map((s: string) => s.trim());
      if (options.exclude) data.exclude = options.exclude.split(',').map((s: string) => s.trim());
      if (options.pin) data.pin = true;

      const filePath = await saveRecipe(data, process.cwd(), Boolean(options.global));
      const scope = options.global ? 'global' : 'project';
      console.log(`Recipe '${name}' saved (${scope}): ${filePath}`);
    });

  recipe
    .command('run <name> [keywords]')
    .description('Execute a saved recipe')
    .option('--format <format>', 'Output format: xml, markdown, or json', 'xml')
    .option('--full', 'Output full context instead of summary + ID')
    .action(async (name: string, keywords: string | undefined, options) => {
      const data = await loadRecipe(name);
      if (!data) {
        console.error(`Recipe not found: ${name}`);
        process.exit(1);
      }

      const task = keywords || data.keywords || '';
      if (!task) {
        console.error('No keywords provided and recipe has no default keywords.');
        process.exit(1);
      }

      const backend = await getBackend();
      const engine = createSlicerEngine(backend);
      const format = options.format as OutputFormat;

      const request = {
        task,
        repoRoot: process.cwd(),
        budgetTokens: data.budget ?? 32000,
        intensity: data.intensity,
        strategies: data.strategies,
        include: data.include,
        exclude: data.exclude,
      };

      console.error(`Running recipe '${name}': ${task}`);
      const plan = await engine.plan(request);
      const result = await engine.assemble(plan, request.budgetTokens);

      if (options.full) {
        const output = formatContext(result.context, format);
        console.log(output);
        return;
      }

      const content = formatContext(result.context, format);
      const meta = await saveContext(content, {
        task: result.context.task,
        files: result.context.files.length,
        tokens: result.totalTokens,
        budget: request.budgetTokens,
      }, process.cwd(), data.pin);

      const budget = request.budgetTokens;
      const usage = budget > 0
        ? `(${((result.totalTokens / budget) * 100).toFixed(0)}% of ${formatTokens(budget)})`
        : '';
      const pinLabel = meta.pinned ? ' [pinned]' : '';
      console.log(`${meta.id}  ${result.context.files.length} files  ${formatTokens(result.totalTokens)} tokens  ${usage}${pinLabel}`);
    });

  recipe
    .command('list')
    .description('List all recipes (project + global)')
    .action(async () => {
      const recipes = await listRecipes();
      if (recipes.length === 0) {
        console.log('No recipes found.');
        console.log('Use: ivo recipe save <name> [options]');
        return;
      }

      console.log('Recipes:\n');
      for (const r of recipes) {
        const scope = r.scope === 'global' ? ' (global)' : '';
        const desc = r.description ? ` — ${r.description}` : '';
        const intensity = r.intensity ? ` [${r.intensity}]` : '';
        const strategies = r.strategies?.length ? ` strategies: ${r.strategies.join(',')}` : '';
        console.log(`  ${r.name}${scope}${intensity}${desc}`);
        if (strategies) console.log(`    ${strategies}`);
        if (r.keywords) console.log(`    keywords: ${r.keywords}`);
      }
    });

  recipe
    .command('show <name>')
    .description('Display recipe configuration')
    .action(async (name: string) => {
      const data = await loadRecipe(name);
      if (!data) {
        console.error(`Recipe not found: ${name}`);
        process.exit(1);
      }
      console.log(JSON.stringify(data, null, 2));
    });

  recipe
    .command('delete <name>')
    .description('Remove a recipe')
    .option('-g, --global', 'Delete global recipe')
    .action(async (name: string, options) => {
      const deleted = await deleteRecipe(name, process.cwd(), Boolean(options.global));
      if (deleted) {
        console.log(`Recipe '${name}' deleted.`);
      } else {
        console.error(`Recipe not found: ${name}`);
        process.exit(1);
      }
    });
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  return String(tokens);
}
