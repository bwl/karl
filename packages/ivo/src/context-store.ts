/**
 * Context Store
 *
 * Manages context files with git-style IDs.
 * Stores prepared context in .ivo/contexts/ for retrieval by any agent.
 */

import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

// ============================================================================
// Types
// ============================================================================

export interface ContextMeta {
  id: string;           // git-style short hash, e.g., "a7b2c3d"
  task: string;
  files: number;
  tokens: number;
  budget: number;
  createdAt: string;
  pinned?: boolean;
}

// ============================================================================
// ID Generation
// ============================================================================

/**
 * Generate a git-style short hash from content.
 * Uses SHA256, takes first 7 hex characters.
 */
export function generateContextId(content: string): string {
  const hash = createHash('sha256').update(content).digest('hex');
  return hash.slice(0, 7);
}

// ============================================================================
// File Management
// ============================================================================

/**
 * Get the contexts directory path (.ivo/contexts/)
 */
export function getContextsDir(cwd: string = process.cwd()): string {
  return path.join(cwd, '.ivo', 'contexts');
}

/**
 * Get the full path for a context file by ID.
 */
export function getContextPath(id: string, cwd: string = process.cwd()): string {
  return path.join(getContextsDir(cwd), `${id}.xml`);
}

/**
 * Get the full path for a context metadata file by ID.
 */
export function getMetaPath(id: string, cwd: string = process.cwd()): string {
  return path.join(getContextsDir(cwd), `${id}.meta.json`);
}

/**
 * Ensure the contexts directory exists.
 */
export async function ensureContextsDir(cwd: string = process.cwd()): Promise<void> {
  await fs.mkdir(getContextsDir(cwd), { recursive: true });
}

/**
 * Save context content and metadata.
 * Returns the complete metadata including generated ID.
 */
export async function saveContext(
  content: string,
  meta: Partial<Omit<ContextMeta, 'id' | 'createdAt'>>,
  cwd: string = process.cwd(),
  pinned?: boolean
): Promise<ContextMeta> {
  await ensureContextsDir(cwd);

  const id = generateContextId(content);
  const fullMeta: ContextMeta = {
    id,
    task: meta.task ?? '',
    files: meta.files ?? 0,
    tokens: meta.tokens ?? 0,
    budget: meta.budget ?? 0,
    createdAt: new Date().toISOString(),
    ...(pinned ? { pinned: true } : {}),
  };

  // Write content and metadata
  await Promise.all([
    fs.writeFile(getContextPath(id, cwd), content, 'utf-8'),
    fs.writeFile(getMetaPath(id, cwd), JSON.stringify(fullMeta, null, 2), 'utf-8')
  ]);

  return fullMeta;
}

/**
 * Load context content by ID.
 */
export async function loadContext(id: string, cwd: string = process.cwd()): Promise<string | null> {
  try {
    return await fs.readFile(getContextPath(id, cwd), 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Load context metadata by ID.
 */
export async function loadContextMeta(id: string, cwd: string = process.cwd()): Promise<ContextMeta | null> {
  try {
    const content = await fs.readFile(getMetaPath(id, cwd), 'utf-8');
    return JSON.parse(content) as ContextMeta;
  } catch {
    return null;
  }
}

/**
 * Check if a context exists by ID.
 */
export async function contextExists(id: string, cwd: string = process.cwd()): Promise<boolean> {
  try {
    await fs.access(getContextPath(id, cwd));
    return true;
  } catch {
    return false;
  }
}

/**
 * List all saved contexts with metadata.
 */
export async function listContexts(cwd: string = process.cwd()): Promise<ContextMeta[]> {
  try {
    const dir = getContextsDir(cwd);
    const entries = await fs.readdir(dir);
    const metaFiles = entries.filter(f => f.endsWith('.meta.json'));
    const contexts: ContextMeta[] = [];

    for (const file of metaFiles) {
      try {
        const content = await fs.readFile(path.join(dir, file), 'utf-8');
        contexts.push(JSON.parse(content) as ContextMeta);
      } catch {
        // Skip malformed meta files
      }
    }

    // Sort by creation time (newest first)
    contexts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return contexts;
  } catch {
    return [];
  }
}

/**
 * Find a context by partial ID match (like git).
 */
export async function findContextById(partialId: string, cwd: string = process.cwd()): Promise<ContextMeta | null> {
  const contexts = await listContexts(cwd);
  const matches = contexts.filter(c => c.id.startsWith(partialId));

  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  // Ambiguous - return null and let caller handle
  return null;
}

/**
 * Pin a context so it won't be auto-cleaned.
 */
export async function pinContext(id: string, cwd: string = process.cwd()): Promise<boolean> {
  const meta = await loadContextMeta(id, cwd);
  if (!meta) return false;
  meta.pinned = true;
  await fs.writeFile(getMetaPath(meta.id, cwd), JSON.stringify(meta, null, 2), 'utf-8');
  return true;
}

/**
 * Unpin a context so it can be auto-cleaned.
 */
export async function unpinContext(id: string, cwd: string = process.cwd()): Promise<boolean> {
  const meta = await loadContextMeta(id, cwd);
  if (!meta) return false;
  delete meta.pinned;
  await fs.writeFile(getMetaPath(meta.id, cwd), JSON.stringify(meta, null, 2), 'utf-8');
  return true;
}

/**
 * Clean up old context files.
 * Pinned contexts are never deleted.
 * @param maxAgeMs Maximum age in milliseconds (default: 24 hours)
 * @param maxCount Maximum number of contexts to keep (default: 50)
 */
export async function cleanupOldContexts(
  cwd: string = process.cwd(),
  maxAgeMs: number = 24 * 60 * 60 * 1000,
  maxCount: number = 50
): Promise<{ deleted: number }> {
  try {
    const dir = getContextsDir(cwd);
    const entries = await fs.readdir(dir);

    // Get all .meta.json files with their stats
    const metaFiles = entries.filter(f => f.endsWith('.meta.json'));
    const contextInfos: Array<{ id: string; createdAt: Date; pinned: boolean }> = [];

    for (const file of metaFiles) {
      try {
        const content = await fs.readFile(path.join(dir, file), 'utf-8');
        const meta = JSON.parse(content) as ContextMeta;
        contextInfos.push({
          id: meta.id,
          createdAt: new Date(meta.createdAt),
          pinned: Boolean(meta.pinned),
        });
      } catch {
        // Skip malformed meta files
      }
    }

    // Sort by creation time (newest first)
    contextInfos.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const now = Date.now();
    const toDelete: string[] = [];
    let unpinnedIndex = 0;

    for (const info of contextInfos) {
      // Never delete pinned contexts
      if (info.pinned) continue;

      const age = now - info.createdAt.getTime();
      // Delete if too old OR if beyond max count (among unpinned)
      if (age > maxAgeMs || unpinnedIndex >= maxCount) {
        toDelete.push(info.id);
      }
      unpinnedIndex++;
    }

    // Delete context and meta files
    for (const id of toDelete) {
      try {
        await Promise.all([
          fs.unlink(getContextPath(id, cwd)).catch(() => {}),
          fs.unlink(getMetaPath(id, cwd)).catch(() => {})
        ]);
      } catch {
        // Ignore deletion errors
      }
    }

    return { deleted: toDelete.length };
  } catch {
    // Directory might not exist yet
    return { deleted: 0 };
  }
}
