import path from 'path';
import { diffContextManifests, inspectContextPack, readContextContent } from '../context-store.js';
import { resolveHomePath } from '../utils.js';

interface ContextOptions {
  command: 'show' | 'diff';
  ids: string[];
  cwd: string;
  json: boolean;
  content: boolean;
}

function help(): void {
  console.log(`karl context show <id> [--json] [--content] [--cwd <path>]
karl context diff <old> <new> [--json] [--cwd <path>]

Inspect Ivo content through Karl manifests. Full pack content is hidden unless
--content is explicitly supplied to context show.`);
}

function parseArgs(args: string[]): ContextOptions {
  const options: ContextOptions = { command: 'show', ids: [], cwd: process.cwd(), json: false, content: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === 'show' || arg === 'diff') options.command = arg;
    else if (arg === '--json' || arg === '-j') options.json = true;
    else if (arg === '--content') options.content = true;
    else if (arg === '--cwd' && args[i + 1]) options.cwd = args[++i];
    else if (arg === '--help' || arg === '-h') { help(); process.exit(0); }
    else options.ids.push(arg);
  }
  return options;
}

export async function handleContextCommand(args: string[]): Promise<void> {
  const options = parseArgs(args);
  const cwd = path.resolve(resolveHomePath(options.cwd));
  try {
    if (options.command === 'diff') {
      if (options.ids.length !== 2) throw new Error('context diff requires <old> and <new> IDs');
      const diff = await diffContextManifests(options.ids[0], options.ids[1], cwd);
      if (options.json) console.log(JSON.stringify(diff, null, 2));
      else {
        console.log(`Context diff: ${diff.oldId} -> ${diff.newId}`);
        for (const file of diff.added) console.log(`+ ${file.path}`);
        for (const file of diff.removed) console.log(`- ${file.path}`);
        for (const file of diff.changed) console.log(`~ ${file.path}`);
      }
      return;
    }
    if (options.ids.length !== 1) throw new Error('context show requires one context ID');
    const pack = await inspectContextPack(options.ids[0], cwd);
    const output = options.content ? { ...pack, content: await readContextContent(options.ids[0], cwd) } : pack;
    if (options.json) console.log(JSON.stringify(output, null, 2));
    else {
      console.log(`Context: ${pack.contextId}${pack.kind === 'karl.legacyContextPack' ? ' (legacy)' : ''}`);
      console.log(`Content: ${pack.packContentPath}`);
      console.log(`Hash: ${pack.packContentHash}`);
      if ('tokens' in pack && pack.tokens) console.log(`Tokens: ${pack.tokens.actual}/${pack.tokens.budget}`);
      if ('sourceHead' in pack) console.log(`Source HEAD: ${pack.sourceHead}`);
      if ('fileStates' in pack && pack.fileStates) {
        for (const file of pack.fileStates) console.log(`${file.state === 'current' ? '=' : file.state === 'stale' ? '~' : '!'} ${file.path} (${file.state})`);
      }
      if (options.content) console.log(`\n${await readContextContent(options.ids[0], cwd)}`);
    }
  } catch (error) {
    console.error(`context error: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
