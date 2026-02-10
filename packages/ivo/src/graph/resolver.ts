/**
 * Import Resolver — language-specific import path resolution
 */

import { existsSync } from 'fs';
import { join, dirname, relative } from 'path';
import type { CodeMap } from '../types.js';

/**
 * Resolve a single import specifier to a repo-relative file path.
 * Returns null for external/unresolvable imports.
 */
export function resolveImport(
  specifier: string,
  importerPath: string,
  language: string,
  repoRoot: string
): string | null {
  switch (language) {
    case 'typescript':
    case 'tsx':
    case 'javascript':
    case 'jsx':
      return resolveJsImport(specifier, importerPath, repoRoot);
    case 'python':
      return resolvePythonImport(specifier, importerPath, repoRoot);
    case 'go':
      return resolveGoImport(specifier, repoRoot);
    case 'rust':
      return resolveRustImport(specifier, importerPath, repoRoot);
    default:
      return null;
  }
}

function resolveJsImport(specifier: string, importerPath: string, repoRoot: string): string | null {
  // Only resolve relative imports
  if (!specifier.startsWith('.')) return null;

  const importerDir = dirname(join(repoRoot, importerPath));
  // Strip .js/.ts suffix (ESM convention)
  const base = specifier.replace(/\.(js|ts|tsx|jsx)$/, '');

  const candidates = [
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.js`,
    `${base}/index.jsx`,
  ];

  for (const candidate of candidates) {
    const fullPath = join(importerDir, candidate);
    if (existsSync(fullPath)) {
      return relative(repoRoot, fullPath);
    }
  }

  return null;
}

function resolvePythonImport(specifier: string, importerPath: string, repoRoot: string): string | null {
  // Only resolve relative imports (starting with dots)
  if (!specifier.startsWith('.')) return null;

  const dots = specifier.match(/^\.+/)?.[0].length ?? 0;
  const importerDir = dirname(join(repoRoot, importerPath));

  // Walk up directories based on dot count
  let base = importerDir;
  for (let i = 1; i < dots; i++) {
    base = dirname(base);
  }

  const modulePath = specifier.slice(dots).replace(/\./g, '/');
  const candidates = modulePath
    ? [`${modulePath}.py`, `${modulePath}/__init__.py`]
    : ['__init__.py'];

  for (const candidate of candidates) {
    const fullPath = join(base, candidate);
    if (existsSync(fullPath)) {
      return relative(repoRoot, fullPath);
    }
  }

  return null;
}

function resolveGoImport(specifier: string, repoRoot: string): string | null {
  // Skip stdlib imports (no slash)
  if (!specifier.includes('/')) return null;

  // Heuristic: check if the last segment exists under common dirs
  const lastSegment = specifier.split('/').pop();
  if (!lastSegment) return null;

  const dirs = ['internal', 'pkg', ''];
  for (const dir of dirs) {
    const candidate = dir ? join(repoRoot, dir, lastSegment) : join(repoRoot, lastSegment);
    if (existsSync(candidate)) {
      return relative(repoRoot, candidate);
    }
  }

  return null;
}

function resolveRustImport(specifier: string, importerPath: string, repoRoot: string): string | null {
  let resolved: string;

  if (specifier.startsWith('crate::')) {
    // Resolve from crate root (src/)
    const modulePath = specifier.slice('crate::'.length).replace(/::/g, '/');
    resolved = join(repoRoot, 'src', modulePath);
  } else if (specifier.startsWith('super::')) {
    const parts = specifier.split('::');
    let superCount = 0;
    while (parts[superCount] === 'super') superCount++;
    const rest = parts.slice(superCount).join('/');

    let base = dirname(join(repoRoot, importerPath));
    for (let i = 0; i < superCount; i++) {
      base = dirname(base);
    }
    resolved = join(base, rest);
  } else if (specifier.startsWith('self::')) {
    const modulePath = specifier.slice('self::'.length).replace(/::/g, '/');
    resolved = join(dirname(join(repoRoot, importerPath)), modulePath);
  } else {
    return null;
  }

  // Try module.rs then module/mod.rs
  const candidates = [`${resolved}.rs`, join(resolved, 'mod.rs')];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return relative(repoRoot, candidate);
    }
  }

  return null;
}

/**
 * Resolve all imports from a CodeMap's dependencies.
 * Returns unique repo-relative paths.
 */
export function resolveAllImports(
  filePath: string,
  dependencies: string[],
  language: string,
  repoRoot: string
): string[] {
  const resolved = new Set<string>();
  for (const dep of dependencies) {
    const result = resolveImport(dep, filePath, language, repoRoot);
    if (result) {
      resolved.add(result);
    }
  }
  return Array.from(resolved);
}
