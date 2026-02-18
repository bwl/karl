/**
 * Rotating usage hints for different AI code agents
 */

const HINTS = [
  // Claude Code — pipe context as stdin with -p (print/non-interactive mode)
  { example: 'ivo get {id} | claude -p "your task"', label: 'Claude Code' },
  // Codex — pipe prompt via stdin to exec subcommand
  { example: 'ivo get {id} | codex exec -', label: 'Codex' },
  // OpenCode — pipe context to run subcommand
  { example: 'ivo get {id} | opencode run "your task"', label: 'OpenCode' },
  // Aider — --read for read-only context, --message for non-interactive
  { example: 'aider --read <(ivo get {id}) -m "your task"', label: 'Aider' },
  // Generic clipboard
  { example: 'ivo get {id} | pbcopy', label: 'clipboard' },
];

export function getUsageHint(contextId: string): string {
  const hint = HINTS[Math.floor(Math.random() * HINTS.length)];
  return `Use: ${hint.example.replace(/\{id\}/g, contextId)}`;
}

export function getExampleHints(contextId: string = 'a7b2c3d'): string {
  return HINTS
    .map(h => `  ${h.example.replace(/\{id\}/g, contextId).padEnd(52)} # ${h.label}`)
    .join('\n');
}
