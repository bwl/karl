import path from 'path';
import { readTextIfExists, resolveHomePath } from './utils.js';

export async function loadSkill(name: string, cwd: string): Promise<string> {
  const isPathLike = name.includes('/') || name.endsWith('.md');
  if (isPathLike) {
    const directPath = path.isAbsolute(name) ? name : path.join(cwd, name);
    const content = await readTextIfExists(directPath);
    if (content) {
      return content;
    }
    throw new Error(`Skill not found at ${directPath}`);
  }

  const localPath = path.join(cwd, '.cliffy', 'skills', `${name}.md`);
  const globalPath = resolveHomePath(`~/.config/cliffy/skills/${name}.md`);

  const localContent = await readTextIfExists(localPath);
  if (localContent) {
    return localContent;
  }

  const globalContent = await readTextIfExists(globalPath);
  if (globalContent) {
    return globalContent;
  }

  throw new Error(`Skill not found: ${name}`);
}
