/**
 * CLI command for displaying a quick reference primer
 */

import { loadConfig } from '../config.js';
import { StackManager } from '../stacks.js';

export async function handleTldrCommand(_args: string[]): Promise<void> {
  const cwd = process.cwd();
  const config = await loadConfig(cwd);

  // Get default model details
  const defaultModelKey = config.defaultModel;
  const defaultModelConfig = config.models[defaultModelKey];
  const providerName = defaultModelConfig?.provider ?? 'unknown';

  // Get available stacks
  const stackManager = new StackManager(config);
  const stacks = await stackManager.listStacks();

  // Build output
  const lines: string[] = [];

  lines.push('# Karl - AI Agent CLI');
  lines.push('');
  lines.push('Karl is a Unix-native AI agent. Pipe text in, get answers out. Configure');
  lines.push('models from any provider, add skills for domain expertise, and bundle');
  lines.push('everything into stacks that become commands.');
  lines.push('');
  lines.push('  echo "explain this" | karl run -              Read task from stdin');
  lines.push('  karl run "task" --context-file notes.md      Include file as context');
  lines.push('  karl review "check auth.ts"                  Stack as verb');
  lines.push('');
  lines.push('## Quick Start');
  lines.push('  karl run "your task"         Run with default model');
  lines.push('  karl <stack> "task"          Run with a named stack');
  lines.push('');
  lines.push('## Current Setup');
  lines.push(`  Default Model: ${defaultModelKey} (${providerName})`);

  if (stacks.length > 0) {
    lines.push('');
    lines.push('  Available Stacks:');
    const maxToShow = 5;
    const displayStacks = stacks.slice(0, maxToShow);
    const maxNameLen = Math.max(...displayStacks.map(s => s.name.length));

    for (const stack of displayStacks) {
      const paddedName = stack.name.padEnd(maxNameLen);
      lines.push(`    ${paddedName}  karl ${stack.name} "..."`);
    }

    if (stacks.length > maxToShow) {
      lines.push(`    ... and ${stacks.length - maxToShow} more (karl stacks list)`);
    }
  }

  lines.push('');
  lines.push('## Key Commands');
  lines.push('  karl init              Setup wizard');
  lines.push('  karl models list       See configured models');
  lines.push('  karl stacks list       See all stacks');
  lines.push('  karl skills list       See available skills');
  lines.push('  karl config            Config TUI and JSON views');
  lines.push('  karl info              Full system status');
  lines.push('  karl --help            All options');

  console.log(lines.join('\n'));
}
