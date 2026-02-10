/**
 * Structure Command - Get code structure (codemaps)
 */

import type { Command } from 'commander';
import type { IvoBackend } from '../backends/types.js';
import type { StructureOptions } from '../types.js';
import { formatStructureJson } from '../output/json.js';

export function registerStructureCommand(program: Command, getBackend: () => Promise<IvoBackend>): void {
  program
    .command('structure [paths...]')
    .alias('map')
    .description('Get code structure (codemaps) for files or directories')
    .option('-s, --scope <scope>', 'Scope: paths or selected', 'paths')
    .option('-n, --max <n>', 'Maximum codemaps to return', parseInt)
    .option('--json', 'Output as JSON')
    .action(async (paths: string[], options) => {
      try {
        const backend = await getBackend();

        const structureOpts: StructureOptions = {
          scope: options.scope as 'paths' | 'selected',
          maxResults: options.max,
        };

        // If no paths provided and scope is 'paths', default to current directory
        if (paths.length === 0 && structureOpts.scope === 'paths') {
          structureOpts.scope = 'selected';
        }

        // For display, get raw output if available
        const rpBackend = backend as { getStructureRaw?: typeof backend.getStructure };
        if (!options.json && rpBackend.getStructureRaw) {
          const raw = await rpBackend.getStructureRaw(paths, structureOpts);
          console.log(raw);
          return;
        }

        const result = await backend.getStructure(paths, structureOpts);

        if (options.json) {
          console.log(formatStructureJson(result));
        } else {
          // Human-readable output
          if (result.codemaps.length === 0) {
            console.log('No codemaps found.');
            if (result.filesWithoutCodemap.length > 0) {
              console.log(`\nFiles without codemap (${result.filesWithoutCodemap.length}):`);
              for (const file of result.filesWithoutCodemap) {
                console.log(`  ${file}`);
              }
            }
            return;
          }

          for (const codemap of result.codemaps) {
            console.log(`\n${'='.repeat(60)}`);
            console.log(`File: ${codemap.path}`);
            console.log(`Language: ${codemap.language}`);
            console.log('='.repeat(60));

            if (codemap.language === 'markdown') {
              // Markdown-specific rendering
              if (codemap.sections && codemap.sections.length > 0) {
                console.log('\nSections:');
                for (const s of codemap.sections) {
                  console.log(`${'  '.repeat(s.depth)}${'#'.repeat(s.depth)} ${s.title}`);
                }
              }
              if (codemap.frontmatter && codemap.frontmatter.length > 0) {
                console.log(`\nFront-matter: ${codemap.frontmatter.join(', ')}`);
              }
              if (codemap.codeBlocks) {
                const langs = codemap.codeBlocks.languages.length > 0
                  ? ` (${codemap.codeBlocks.languages.join(', ')})`
                  : '';
                console.log(`Code blocks: ${codemap.codeBlocks.count}${langs}`);
              }
              continue;
            }

            if (codemap.exports.length > 0) {
              console.log(`\nExports: ${codemap.exports.join(', ')}`);
            }

            if (codemap.dependencies.length > 0) {
              console.log(`Dependencies: ${codemap.dependencies.join(', ')}`);
            }

            if (codemap.classes.length > 0) {
              console.log('\nClasses:');
              for (const cls of codemap.classes) {
                console.log(`  ${cls.name}`);
                if (cls.properties.length > 0) {
                  console.log(`    Properties: ${cls.properties.join(', ')}`);
                }
                if (cls.methods.length > 0) {
                  console.log(`    Methods: ${cls.methods.join(', ')}`);
                }
              }
            }

            if (codemap.functions.length > 0) {
              console.log('\nFunctions:');
              for (const fn of codemap.functions) {
                const asyncPrefix = fn.async ? 'async ' : '';
                console.log(`  ${asyncPrefix}${fn.signature}`);
              }
            }

            if (codemap.types.length > 0) {
              console.log('\nTypes:');
              for (const t of codemap.types) {
                console.log(`  ${t.kind} ${t.name}`);
              }
            }
          }

          if (result.filesWithoutCodemap.length > 0) {
            console.log(`\n${'='.repeat(60)}`);
            console.log(`Files without codemap (${result.filesWithoutCodemap.length}):`);
            for (const file of result.filesWithoutCodemap) {
              console.log(`  ${file}`);
            }
          }
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
