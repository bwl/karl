/**
 * Backend interface for Ivo
 *
 * Abstracts file system and code analysis operations.
 * Currently uses native backend with ripgrep, tree-sitter, etc.
 */

import type {
  TreeOptions,
  SearchOptions,
  SearchResult,
  StructureOptions,
  StructureResult,
  SelectionResult,
  ContextOptions,
  ContextResult,
} from '../types.js';

export interface IvoBackend {
  /** Backend identifier */
  readonly name: string;

  /** Check if this backend is available */
  isAvailable(): Promise<boolean>;

  // =========================================================================
  // File Tree
  // =========================================================================

  /**
   * Get file tree for the workspace
   */
  getTree(opts?: TreeOptions): Promise<string>;

  // =========================================================================
  // Search
  // =========================================================================

  /**
   * Search files by pattern (path or content)
   */
  search(pattern: string, opts?: SearchOptions): Promise<SearchResult>;

  // =========================================================================
  // Code Structure
  // =========================================================================

  /**
   * Get code structure (codemaps) for files/directories
   */
  getStructure(paths: string[], opts?: StructureOptions): Promise<StructureResult>;

  // =========================================================================
  // Selection Management
  // =========================================================================

  /**
   * Get current file selection
   */
  getSelection(): Promise<SelectionResult>;

  /**
   * Replace selection with new paths
   */
  setSelection(paths: string[]): Promise<void>;

  /**
   * Add paths to selection
   */
  addToSelection(paths: string[]): Promise<void>;

  /**
   * Remove paths from selection
   */
  removeFromSelection(paths: string[]): Promise<void>;

  /**
   * Clear all selection
   */
  clearSelection(): Promise<void>;

  // =========================================================================
  // Context Building
  // =========================================================================

  /**
   * Build optimal context for a task using AI-powered exploration
   */
  buildContext(task: string, opts?: ContextOptions): Promise<ContextResult>;

  /**
   * Get workspace context snapshot (prompt, selection, codemaps)
   */
  getWorkspaceContext(opts?: ContextOptions): Promise<ContextResult>;
}

/**
 * Factory function type for creating backends
 */
export type BackendFactory = () => IvoBackend;

/**
 * Registry of available backends
 */
export const backends: Map<string, BackendFactory> = new Map();

/**
 * Register a backend factory
 */
export function registerBackend(name: string, factory: BackendFactory): void {
  backends.set(name, factory);
}

/**
 * Get a backend by name
 */
export function getBackend(name: string): IvoBackend | undefined {
  const factory = backends.get(name);
  return factory?.();
}

/**
 * Get the default backend (first available)
 */
export async function getDefaultBackend(): Promise<IvoBackend | undefined> {
  for (const [, factory] of backends) {
    const backend = factory();
    if (await backend.isAvailable()) {
      return backend;
    }
  }
  return undefined;
}
