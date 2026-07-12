import path from 'path';

const COMMIT_INTENT = [
  /^\s*(?:please\s+)?commit\b/i,
  /\b(?:then|and)\s+commit\b/i,
  /\b(?:create|make)\s+(?:separate\s+|logical\s+|the\s+)?commits?\b/i,
  /\bgroup\b[^.!?\n]{0,80}\bcommits?\b/i,
  /^\s*(?:please\s+)?(?:run|use)\s+git\s+commit\b/i,
];

const NEGATED_COMMIT = /\b(?:do\s+not|don't|dont|never|without|no)\b[^.!?\n]{0,50}\bcommits?\b/i;
const SHELL_CONTROL = /[;&|<>`\n\r]|\$\(/;

export function hasExplicitCommitIntent(task: string): boolean {
  if (NEGATED_COMMIT.test(task)) return false;
  return COMMIT_INTENT.some(pattern => pattern.test(task));
}

function isWithin(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function commandText(params: unknown): string | null {
  if (!params || typeof params !== 'object') return null;
  const command = (params as { command?: unknown }).command;
  if (typeof command === 'string') return command.trim();
  if (Array.isArray(command) && command.every(part => typeof part === 'string')) {
    return command.join(' ').trim();
  }
  return null;
}

export function isAllowedCommitCommand(params: unknown, workspaceRoot: string): boolean {
  if (!params || typeof params !== 'object') return false;
  const cwdValue = (params as { cwd?: unknown }).cwd;
  if (typeof cwdValue !== 'string' || !isWithin(path.resolve(cwdValue), path.resolve(workspaceRoot))) return false;

  const command = commandText(params);
  if (!command || SHELL_CONTROL.test(command)) return false;
  const match = command.match(/^(?:\/usr\/bin\/|\/opt\/homebrew\/bin\/)?git\s+([a-z-]+)(?:\s|$)/i);
  return match?.[1] === 'add' || match?.[1] === 'commit';
}

export function commitAuthorityInstructions(workspaceRoot: string): string {
  return [
    '',
    'Git commit authority:',
    `The operator explicitly authorized local git add and git commit operations inside ${workspaceRoot}.`,
    'Request sandbox escalation for each standalone git add or git commit command when needed.',
    'This authority does not include push, reset, clean, checkout, restore, worktree removal, shell command chains, or writes outside the workspace.',
  ].join('\n');
}
