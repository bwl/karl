/**
 * Recipe Store
 *
 * Manages reusable context-building recipes.
 * Recipes are saved bucket configurations stored in .ivo/recipes/ (project)
 * and ~/.config/ivo/recipes/ (global).
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import type { SliceIntensity, SliceStrategy } from './slicer/types.js';

export interface Recipe {
  name: string;
  description?: string;
  keywords?: string;
  intensity?: SliceIntensity;
  strategies?: SliceStrategy[];
  budget?: number;
  include?: string[];
  exclude?: string[];
  pin?: boolean;
  createdAt: string;
}

function getProjectRecipesDir(cwd: string = process.cwd()): string {
  return path.join(cwd, '.ivo', 'recipes');
}

function getGlobalRecipesDir(): string {
  return path.join(os.homedir(), '.config', 'ivo', 'recipes');
}

function recipePath(dir: string, name: string): string {
  return path.join(dir, `${name}.json`);
}

export async function saveRecipe(
  recipe: Recipe,
  cwd: string = process.cwd(),
  global: boolean = false
): Promise<string> {
  const dir = global ? getGlobalRecipesDir() : getProjectRecipesDir(cwd);
  await fs.mkdir(dir, { recursive: true });
  const filePath = recipePath(dir, recipe.name);
  await fs.writeFile(filePath, JSON.stringify(recipe, null, 2), 'utf-8');
  return filePath;
}

export async function loadRecipe(
  name: string,
  cwd: string = process.cwd()
): Promise<Recipe | null> {
  // Project-local first, then global
  const projectPath = recipePath(getProjectRecipesDir(cwd), name);
  try {
    const content = await fs.readFile(projectPath, 'utf-8');
    return JSON.parse(content) as Recipe;
  } catch {
    // Fall through to global
  }

  const globalPath = recipePath(getGlobalRecipesDir(), name);
  try {
    const content = await fs.readFile(globalPath, 'utf-8');
    return JSON.parse(content) as Recipe;
  } catch {
    return null;
  }
}

async function listRecipesFromDir(dir: string): Promise<Recipe[]> {
  try {
    const entries = await fs.readdir(dir);
    const recipes: Recipe[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      try {
        const content = await fs.readFile(path.join(dir, entry), 'utf-8');
        recipes.push(JSON.parse(content) as Recipe);
      } catch {
        // Skip malformed files
      }
    }
    return recipes;
  } catch {
    return [];
  }
}

export async function listRecipes(
  cwd: string = process.cwd()
): Promise<Array<Recipe & { scope: 'project' | 'global' }>> {
  const [projectRecipes, globalRecipes] = await Promise.all([
    listRecipesFromDir(getProjectRecipesDir(cwd)),
    listRecipesFromDir(getGlobalRecipesDir()),
  ]);

  const results: Array<Recipe & { scope: 'project' | 'global' }> = [];
  const seen = new Set<string>();

  // Project recipes take precedence
  for (const recipe of projectRecipes) {
    results.push({ ...recipe, scope: 'project' });
    seen.add(recipe.name);
  }

  for (const recipe of globalRecipes) {
    if (!seen.has(recipe.name)) {
      results.push({ ...recipe, scope: 'global' });
    }
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

export async function deleteRecipe(
  name: string,
  cwd: string = process.cwd(),
  global: boolean = false
): Promise<boolean> {
  const dir = global ? getGlobalRecipesDir() : getProjectRecipesDir(cwd);
  const filePath = recipePath(dir, name);
  try {
    await fs.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}
