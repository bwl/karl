/**
 * Import Graph Builder — build and traverse file dependency graphs
 */

import type { CodeMap } from '../types.js';
import { resolveAllImports } from './resolver.js';

export interface ImportGraph {
  /** file → files it imports */
  forward: Map<string, Set<string>>;
  /** file → files that import it */
  reverse: Map<string, Set<string>>;
}

/**
 * Build forward and reverse import adjacency maps from resolved CodeMap dependencies.
 */
export function buildImportGraph(codemaps: CodeMap[], repoRoot: string): ImportGraph {
  const forward = new Map<string, Set<string>>();
  const reverse = new Map<string, Set<string>>();

  for (const cm of codemaps) {
    const resolved = resolveAllImports(cm.path, cm.dependencies, cm.language, repoRoot);
    const fwd = forward.get(cm.path) ?? new Set();
    for (const target of resolved) {
      fwd.add(target);

      const rev = reverse.get(target) ?? new Set();
      rev.add(cm.path);
      reverse.set(target, rev);
    }
    forward.set(cm.path, fwd);
  }

  return { forward, reverse };
}

/**
 * BFS from seed files walking both forward and reverse edges.
 * Returns discovered files with their depth from the nearest seed.
 */
export function bfsWalk(
  graph: ImportGraph,
  seeds: string[],
  maxDepth: number
): Map<string, number> {
  const visited = new Map<string, number>();
  const queue: Array<{ file: string; depth: number }> = [];

  for (const seed of seeds) {
    if (!visited.has(seed)) {
      visited.set(seed, 0);
      queue.push({ file: seed, depth: 0 });
    }
  }

  while (queue.length > 0) {
    const { file, depth } = queue.shift()!;
    if (depth >= maxDepth) continue;

    const neighbors = new Set<string>();
    const fwd = graph.forward.get(file);
    if (fwd) for (const f of fwd) neighbors.add(f);
    const rev = graph.reverse.get(file);
    if (rev) for (const f of rev) neighbors.add(f);

    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.set(neighbor, depth + 1);
        queue.push({ file: neighbor, depth: depth + 1 });
      }
    }
  }

  return visited;
}
