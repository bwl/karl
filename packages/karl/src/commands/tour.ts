/**
 * A local, read-only introduction to Karl's execution model and personality.
 * This is deliberately a special screen: operational output stays literal.
 */

import pc from 'picocolors';
import { loadConfig } from '../config.js';
import { StackManager } from '../stacks.js';

function court(width: number): string[] {
  if (width < 62) {
    return [
      '          o',
      "        .'",
      '     K A R L',
      '  +-----+-----+',
      '  |     |     |',
      '  +-----+-----+',
    ];
  }
  return [
    '                         o',
    "                      .'",
    "                   .'",
    '              K  A  R  L',
    '       +---------------------------+',
    '       |             |             |',
    '       |-------------+-------------|',
    '       |             |             |',
    '       +---------------------------+',
  ];
}

export async function handleTourCommand(args: string[]): Promise<void> {
  const plain = args.includes('--plain');
  const configuredWidth = Number(process.env.COLUMNS);
  const width = process.stdout.columns || (Number.isFinite(configuredWidth) ? configuredWidth : 80);
  const heading = (value: string) => plain ? value : pc.bold(value);
  const accent = (value: string) => plain ? value : pc.cyan(value);
  const quiet = (value: string) => plain ? value : pc.dim(value);
  const namesake = plain ? 'Ivo Karlovic' : 'Ivo Karlović';

  let defaultModel = '(none configured)';
  let providerCount = 0;
  let stackCount = 0;
  try {
    const config = await loadConfig(process.cwd());
    const model = config.models[config.defaultModel];
    defaultModel = model
      ? `${config.defaultModel} -> ${model.provider}/${model.model}`
      : config.defaultModel || '(none configured)';
    providerCount = Object.keys(config.providers).length;
    stackCount = (await new StackManager(config).listStacks()).length;
  } catch {
    // The tour still works when configuration is incomplete or malformed.
  }

  const lines = [
    '',
    ...court(width).map(accent),
    '',
    heading('ONE SERVE. ONE ACE.'),
    heading('INSPECT THE RECEIPT.'),
    '',
    `Karl is named for ${namesake}: 13,728 career aces and a taste for`,
    'short points. The CLI keeps the same economy, with better receipts.',
    '',
    quiet('This tour reads local configuration only. No model call, no task execution.'),
    '',
    heading('[1] SERVE'),
    '    karl run "explain this module"',
    '    Direct execution through a configured model or stack.',
    '',
    heading('[2] CALL IN MAGIC'),
    '    karl magic --luna "implement the bounded task"',
    '    Luna + Max is the everyday Codex lane. Add --sol deliberately when',
    '    the point is unusually difficult or high-stakes.',
    '',
    heading('[3] KEEP IT IN BOUNDS'),
    '    karl magic --worktree --require-clean --receipt "..."',
    '    Consequential work starts from clean HEAD in a retained worktree.',
    '    Karl does not commit, merge, push, or clean it up for you.',
    '',
    heading('[4] CHECK THE SCORE'),
    '    karl history',
    '    karl history <run-id> --events',
    '    Review commands, files, tokens, diffs, and the terminal reason.',
    '',
    heading('[5] CHOOSE THE VOLUME'),
    '    default       bounded progress and a durable receipt',
    '    --quiet       final answer only',
    '    --verbose     command lifecycle, output, and diffs',
    '    --json        machine-readable final output',
    '',
    heading('YOUR COURT'),
    `    Default model: ${defaultModel}`,
    `    Providers: ${providerCount}  Stacks: ${stackCount}`,
    '',
    quiet('Some points take longer. The scoreboard should never lie.'),
    '',
    'Next: karl tldr    Full reference: karl --help',
    '',
  ];

  console.log(lines.join('\n'));
}
