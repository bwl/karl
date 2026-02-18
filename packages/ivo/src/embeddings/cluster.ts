/**
 * Agglomerative Clustering — groups files by semantic similarity
 */

import { resolveLlmConfig, chatComplete } from '../llm.js';
import type { IvoConfig } from '../config.js';
import { cosineSimilarity, type EmbeddingIndex } from './index.js';

export interface ClusterNode {
  label: string;           // 2-5 word label
  files: string[];         // all files in this cluster (leaf paths)
  children: ClusterNode[]; // sub-clusters (empty for leaves)
}

export interface ClusterOptions {
  maxClusters?: number;    // max top-level clusters (default 12)
  maxLeaves?: number;      // max files before recursive subdivision (default 20)
  distanceThreshold?: number; // stop merging above this (default 0.7)
}

interface InternalCluster {
  files: string[];
  embeddingIndices: number[]; // indices into the embeddings array
}

/**
 * Agglomerative clustering with average-linkage on cosine distance.
 */
export function clusterFiles(
  index: EmbeddingIndex,
  options?: ClusterOptions
): ClusterNode[] {
  const maxClusters = options?.maxClusters ?? 12;
  const maxLeaves = options?.maxLeaves ?? 20;
  const distanceThreshold = options?.distanceThreshold ?? 0.7;

  const entries = index.entries;
  if (entries.length === 0) return [];

  const embeddings = entries.map((e) => e.embedding);
  const paths = entries.map((e) => e.path);

  const topClusters = agglomerate(paths, embeddings, maxClusters, distanceThreshold);

  // Recursively subdivide large clusters
  return topClusters.map((cluster) =>
    subdivideCluster(cluster, embeddings, paths, maxLeaves, distanceThreshold)
  );
}

function agglomerate(
  paths: string[],
  embeddings: number[][],
  maxClusters: number,
  distanceThreshold: number
): InternalCluster[] {
  // Start with each file as a singleton cluster
  let clusters: InternalCluster[] = paths.map((_, i) => ({
    files: [paths[i]],
    embeddingIndices: [i],
  }));

  if (clusters.length <= maxClusters) {
    return clusters;
  }

  // Precompute pairwise cosine distances
  const n = embeddings.length;
  const dist = new Float32Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = 1 - cosineSimilarity(embeddings[i], embeddings[j]);
      dist[i * n + j] = d;
      dist[j * n + i] = d;
    }
  }

  // Merge until we reach maxClusters or distance threshold
  while (clusters.length > maxClusters) {
    let minDist = Infinity;
    let mergeA = 0;
    let mergeB = 1;

    // Find closest pair (average-linkage)
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const d = averageLinkage(clusters[i], clusters[j], dist, n);
        if (d < minDist) {
          minDist = d;
          mergeA = i;
          mergeB = j;
        }
      }
    }

    if (minDist > distanceThreshold) break;

    // Merge
    const merged: InternalCluster = {
      files: [...clusters[mergeA].files, ...clusters[mergeB].files],
      embeddingIndices: [...clusters[mergeA].embeddingIndices, ...clusters[mergeB].embeddingIndices],
    };

    clusters = clusters.filter((_, i) => i !== mergeA && i !== mergeB);
    clusters.push(merged);
  }

  // Sort by size descending
  clusters.sort((a, b) => b.files.length - a.files.length);
  return clusters;
}

function averageLinkage(
  a: InternalCluster,
  b: InternalCluster,
  dist: Float32Array,
  n: number
): number {
  let sum = 0;
  let count = 0;
  for (const i of a.embeddingIndices) {
    for (const j of b.embeddingIndices) {
      sum += dist[i * n + j];
      count++;
    }
  }
  return count === 0 ? Infinity : sum / count;
}

function subdivideCluster(
  cluster: InternalCluster,
  allEmbeddings: number[][],
  allPaths: string[],
  maxLeaves: number,
  distanceThreshold: number
): ClusterNode {
  if (cluster.files.length <= maxLeaves) {
    return {
      label: patternLabel(cluster.files),
      files: cluster.files,
      children: [],
    };
  }

  // Re-cluster within this group
  const subEmbeddings = cluster.embeddingIndices.map((i) => allEmbeddings[i]);
  const subPaths = cluster.files;
  const subClusters = agglomerate(subPaths, subEmbeddings, Math.min(6, Math.ceil(cluster.files.length / maxLeaves) + 1), distanceThreshold);

  const children = subClusters.map((sub) => {
    // Map back to global indices for further subdivision
    const globalCluster: InternalCluster = {
      files: sub.files,
      embeddingIndices: sub.files.map((f) => allPaths.indexOf(f)),
    };
    return subdivideCluster(globalCluster, allEmbeddings, allPaths, maxLeaves, distanceThreshold);
  });

  return {
    label: patternLabel(cluster.files),
    files: cluster.files,
    children,
  };
}

/**
 * Generate a label from file path patterns (common prefix/suffix detection).
 * Inspired by semantic-navigator's to_pattern().
 */
function patternLabel(files: string[]): string {
  if (files.length === 0) return 'Empty';
  if (files.length === 1) return files[0].split('/').pop() ?? files[0];

  // Find common directory prefix
  const parts = files.map((f) => f.split('/'));
  let commonDepth = 0;
  const minLen = Math.min(...parts.map((p) => p.length));

  for (let i = 0; i < minLen - 1; i++) {
    const segment = parts[0][i];
    if (parts.every((p) => p[i] === segment)) {
      commonDepth = i + 1;
    } else {
      break;
    }
  }

  if (commonDepth > 0) {
    const prefix = parts[0].slice(0, commonDepth).join('/');
    return `${prefix}/ (${files.length} files)`;
  }

  // Find common extension
  const exts = files.map((f) => {
    const dot = f.lastIndexOf('.');
    return dot >= 0 ? f.slice(dot) : '';
  });
  const commonExt = exts.every((e) => e === exts[0]) ? exts[0] : '';

  if (commonExt) {
    return `*${commonExt} (${files.length} files)`;
  }

  return `${files.length} files`;
}

/**
 * Label clusters using LLM — sends member file paths to generate 2-5 word labels.
 */
export async function labelClusters(
  clusters: ClusterNode[],
  config: IvoConfig
): Promise<ClusterNode[]> {
  const llm = resolveLlmConfig(config);
  if (!llm) return clusters; // Fall back to pattern labels

  const prompt = buildLabelPrompt(clusters);

  try {
    const content = await chatComplete(llm, [
      { role: 'user', content: prompt },
    ], { temperature: 0.3, maxTokens: 500, timeoutMs: 10000 });

    return applyLabels(clusters, content);
  } catch {
    return clusters;
  }
}

function buildLabelPrompt(clusters: ClusterNode[]): string {
  const groups = clusters.map((c, i) => {
    const sample = c.files.slice(0, 10).join('\n  ');
    const more = c.files.length > 10 ? `\n  ... and ${c.files.length - 10} more` : '';
    return `Group ${i + 1} (${c.files.length} files):\n  ${sample}${more}`;
  });

  return `Label each file group with a concise 2-5 word description of what the group does conceptually. Return one label per line, in order, no numbering or explanation.

${groups.join('\n\n')}`;
}

function applyLabels(clusters: ClusterNode[], content: string): ClusterNode[] {
  const lines = content.trim().split('\n').filter((l) => l.trim());

  return clusters.map((cluster, i) => {
    const label = lines[i]?.trim();
    if (label && label.length > 0 && label.length <= 60) {
      return { ...cluster, label };
    }
    return cluster;
  });
}

/**
 * Format cluster tree for display.
 */
export function formatClusterTree(clusters: ClusterNode[], depth: number = 3): string {
  const lines: string[] = [];

  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i];
    const isLast = i === clusters.length - 1;
    const prefix = isLast ? '└── ' : '├── ';
    lines.push(`${prefix}${cluster.label}`);

    const childPrefix = isLast ? '    ' : '│   ';
    formatClusterNodeLines(cluster, childPrefix, depth - 1, lines);
  }

  return lines.join('\n');
}

function formatClusterNodeLines(
  node: ClusterNode,
  prefix: string,
  remainingDepth: number,
  lines: string[]
): void {
  if (remainingDepth <= 0) return;

  if (node.children.length > 0) {
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      const isLast = i === node.children.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      lines.push(`${prefix}${connector}${child.label}`);

      const childPrefix = prefix + (isLast ? '    ' : '│   ');
      formatClusterNodeLines(child, childPrefix, remainingDepth - 1, lines);
    }
  } else {
    // Show individual files for leaf clusters
    const filesToShow = node.files.slice(0, 8);
    for (let i = 0; i < filesToShow.length; i++) {
      const isLast = i === filesToShow.length - 1 && node.files.length <= 8;
      const connector = isLast ? '└── ' : '├── ';
      lines.push(`${prefix}${connector}${filesToShow[i]}`);
    }
    if (node.files.length > 8) {
      lines.push(`${prefix}└── ... and ${node.files.length - 8} more`);
    }
  }
}
