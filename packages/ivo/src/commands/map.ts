/**
 * Map Command — semantic map of the codebase via embedding clusters
 */

import type { Command } from 'commander';
import { loadConfig } from '../config.js';
import { EmbeddingIndex } from '../embeddings/index.js';
import { clusterFiles, labelClusters, formatClusterTree } from '../embeddings/cluster.js';

export function registerMapCommand(program: Command): void {
  program
    .command('map')
    .description('Show a semantic map of the codebase')
    .option('--depth <n>', 'Max tree depth', parseInt, 3)
    .option('--label', 'Use LLM to label clusters')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const index = await EmbeddingIndex.load(process.cwd());
        if (!index || index.size === 0) {
          console.log('No embedding index found. Run `ivo index` first.');
          return;
        }

        let clusters = clusterFiles(index);

        if (options.label) {
          const config = await loadConfig();
          clusters = await labelClusters(clusters, config);
        }

        if (options.json) {
          console.log(JSON.stringify(clusters, null, 2));
        } else {
          console.log(`Semantic map (${index.size} files)\n`);
          console.log(formatClusterTree(clusters, options.depth));
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
