/**
 * Ivo - Context Intelligence Engine for Karl
 *
 * Library exports for programmatic use.
 */

// Types
export type {
  TreeOptions,
  SearchOptions,
  SearchMatch,
  SearchResult,
  StructureOptions,
  CodeMap,
  ClassInfo,
  FunctionInfo,
  TypeInfo,
  StructureResult,
  SelectionMode,
  SelectionFile,
  SliceRange,
  SelectionResult,
  OutputFormat,
  ContextOptions,
  ContextFile,
  ContextResult,
} from './types.js';

export {
  IvoError,
  BackendNotAvailableError,
  RepoPromptNotRunningError,
} from './types.js';

// Backend
export type { IvoBackend, BackendFactory } from './backends/types.js';
export { registerBackend, getBackend, getDefaultBackend, backends } from './backends/types.js';
export { RepoPromptBackend } from './backends/repoprompt.js';

// Output formatters
export {
  formatXml,
  formatXmlMinimal,
  formatMarkdown,
  formatFileTable,
  formatJson,
  formatSelectionJson,
  formatSearchJson,
  formatStructureJson,
  formatContext,
} from './output/index.js';

// Default export: create a configured Ivo instance
import { getDefaultBackend, type IvoBackend } from './backends/types.js';
import './backends/repoprompt.js';

export async function createIvo(): Promise<IvoBackend | undefined> {
  return getDefaultBackend();
}

export default createIvo;
