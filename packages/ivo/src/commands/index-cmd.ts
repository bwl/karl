/**
 * Index Command — build/refresh the embedding index
 */

import type { Command } from 'commander';
import type { IvoBackend } from '../backends/types.js';
import { loadConfig } from '../config.js';
import { createProvider } from '../embeddings/provider.js';
import { EmbeddingIndex } from '../embeddings/index.js';

export function registerIndexCommand(program: Command, getBackend: () => Promise<IvoBackend>): void {
  program
    .command('index [paths...]')
    .description('Build or refresh the embedding index for semantic search')
    .option('--force', 'Re-embed all files (ignore cache)')
    .option('--stats', 'Show index stats only')
    .option('--dry-run', 'Show what would be embedded without calling API')
    .action(async (_paths: string[], options) => {
      try {
        const config = await loadConfig();

        if (options.stats) {
          const index = await EmbeddingIndex.load(process.cwd());
          if (!index) {
            console.log('No embedding index found. Run `ivo index` to build one.');
            return;
          }
          console.log(`Embedding index stats:`);
          console.log(`  Model:      ${index.model}`);
          console.log(`  Dimensions: ${index.dimensions}`);
          console.log(`  Files:      ${index.size}`);
          return;
        }

        const provider = createProvider(config);
        if (!provider) {
          console.error('No embedding provider configured.');
          console.error('Set OPENAI_API_KEY or configure embeddings in .ivo/config.json');
          process.exit(1);
        }

        const backend = await getBackend();
        const start = Date.now();

        const { stats } = await EmbeddingIndex.build(
          process.cwd(),
          provider,
          backend,
          {
            force: options.force,
            dryRun: options.dryRun,
            onProgress: (msg) => console.log(msg),
          }
        );

        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        const parts = [`Indexed ${stats.total} files`];
        const details: string[] = [];
        if (stats.new > 0) details.push(`${stats.new} new`);
        if (stats.updated > 0) details.push(`${stats.updated} updated`);
        if (stats.removed > 0) details.push(`${stats.removed} removed`);
        if (stats.kept > 0) details.push(`${stats.kept} cached`);
        if (details.length > 0) parts.push(`(${details.join(', ')})`);
        parts.push(`in ${elapsed}s`);

        if (options.dryRun) {
          console.log(`[dry-run] ${parts.join(' ')}`);
        } else {
          console.log(parts.join(' '));
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
