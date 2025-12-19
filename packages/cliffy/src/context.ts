import path from 'path';
import { readTextIfExists, resolveHomePath } from './utils.js';
import { loadSkill } from './skills.js';

const BASE_GUARDRAILS = `You are a helpful coding assistant. Follow these guidelines:

- Only modify files within the current working directory unless explicitly asked otherwise
- Before running destructive commands (rm, overwrite, etc.), confirm the intent
- Prefer reading files before editing to understand context
- Keep changes minimal and focused on the task at hand`;

const CONTEXT_FILES = [
  'CLAUDE.md',
  'AGENTS.md',
  'COPILOT.md',
  '.cursorrules',
  path.join('.github', 'copilot-instructions.md'),
  path.join('.cliffy', 'context.md')
];

export async function loadContextFiles(cwd: string): Promise<string[]> {
  const contents: string[] = [];
  for (const file of CONTEXT_FILES) {
    const content = await readTextIfExists(path.join(cwd, file));
    if (content) {
      contents.push(content.trim());
    }
  }
  return contents.filter(Boolean);
}

export async function buildSystemPrompt(params: {
  cwd: string;
  skill?: string;
  context?: string;
  contextFile?: string;
  unrestricted?: boolean;
}): Promise<string> {
  const parts: string[] = [];

  if (!params.unrestricted) {
    parts.push(BASE_GUARDRAILS);
  }

  const contextFiles = await loadContextFiles(params.cwd);
  parts.push(...contextFiles);

  if (params.skill) {
    const skillContent = await loadSkill(params.skill, params.cwd);
    if (skillContent) {
      parts.push(skillContent.trim());
    }
  }

  if (params.contextFile) {
    const resolvedPath = resolveHomePath(params.contextFile);
    const fullPath = path.isAbsolute(resolvedPath) ? resolvedPath : path.resolve(params.cwd, resolvedPath);
    const extra = await readTextIfExists(fullPath);
    if (extra) {
      parts.push(extra.trim());
    }
  }

  if (params.context) {
    parts.push(params.context.trim());
  }

  return parts.filter(Boolean).join('\n\n');
}
