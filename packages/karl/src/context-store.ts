/**
 * Context Store
 *
 * Manages context files for the orchestrator's ivo integration.
 * Stores prepared context in .karl/contexts/ with git-style IDs.
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
 * Get the contexts directory path (.karl/contexts/)
 */
export function getContextsDir(): string {
  return path.join(process.cwd(), '.karl', 'contexts');
}

/**
 * Get the full path for a context file by ID.
 */
export function getContextPath(id: string): string {
  return path.join(getContextsDir(), `${id}.xml`);
}

/**
 * Get the full path for a context metadata file by ID.
 */
export function getMetaPath(id: string): string {
  return path.join(getContextsDir(), `${id}.meta.json`);
}

/**
 * Ensure the contexts directory exists.
 */
export async function ensureContextsDir(): Promise<void> {
  await fs.mkdir(getContextsDir(), { recursive: true });
}

/**
 * Save context content and metadata.
 * Returns the complete metadata including generated ID.
 */
export async function saveContext(
  content: string,
  meta: Partial<Omit<ContextMeta, 'id' | 'createdAt'>>
): Promise<ContextMeta> {
  await ensureContextsDir();

  const id = generateContextId(content);
  const fullMeta: ContextMeta = {
    id,
    task: meta.task ?? '',
    files: meta.files ?? 0,
    tokens: meta.tokens ?? 0,
    budget: meta.budget ?? 0,
    createdAt: new Date().toISOString()
  };

  // Write content and metadata
  await Promise.all([
    fs.writeFile(getContextPath(id), content, 'utf-8'),
    fs.writeFile(getMetaPath(id), JSON.stringify(fullMeta, null, 2), 'utf-8')
  ]);

  return fullMeta;
}

/**
 * Load context metadata by ID.
 */
export async function loadContextMeta(id: string): Promise<ContextMeta | null> {
  try {
    const metaPath = getMetaPath(id);
    const content = await fs.readFile(metaPath, 'utf-8');
    return JSON.parse(content) as ContextMeta;
  } catch {
    return null;
  }
}

/**
 * Check if a context exists by ID.
 */
export async function contextExists(id: string): Promise<boolean> {
  try {
    await fs.access(getContextPath(id));
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Cleanup
// ============================================================================

/**
 * Clean up old context files.
 * @param maxAgeMs Maximum age in milliseconds (default: 24 hours)
 * @param maxCount Maximum number of contexts to keep (default: 50)
 */
export async function cleanupOldContexts(
  maxAgeMs: number = 24 * 60 * 60 * 1000,
  maxCount: number = 50
): Promise<{ deleted: number }> {
  try {
    const dir = getContextsDir();
    const entries = await fs.readdir(dir);

    // Get all .meta.json files with their stats
    const metaFiles = entries.filter(f => f.endsWith('.meta.json'));
    const contextInfos: Array<{ id: string; createdAt: Date }> = [];

    for (const file of metaFiles) {
      try {
        const content = await fs.readFile(path.join(dir, file), 'utf-8');
        const meta = JSON.parse(content) as ContextMeta;
        contextInfos.push({
          id: meta.id,
          createdAt: new Date(meta.createdAt)
        });
      } catch {
        // Skip malformed meta files
      }
    }

    // Sort by creation time (newest first)
    contextInfos.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const now = Date.now();
    const toDelete: string[] = [];

    contextInfos.forEach((info, index) => {
      const age = now - info.createdAt.getTime();
      // Delete if too old OR if beyond max count
      if (age > maxAgeMs || index >= maxCount) {
        toDelete.push(info.id);
      }
    });

    // Delete context and meta files
    for (const id of toDelete) {
      try {
        await Promise.all([
          fs.unlink(getContextPath(id)).catch(() => {}),
          fs.unlink(getMetaPath(id)).catch(() => {})
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
