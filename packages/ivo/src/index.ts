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

export type {
  SliceStrategy,
  SliceRepresentation,
  SliceIntensity,
  SliceRequest,
  SliceCandidate,
  SlicePlan,
  SliceResult,
  SliceTree,
  SliceAlternate,
  SliceStrategyCaps,
} from './slicer/index.js';

export { IvoError, BackendNotAvailableError } from './types.js';

// Backend
export type { IvoBackend, BackendFactory } from './backends/types.js';
export { registerBackend, getBackend, getDefaultBackend, backends } from './backends/types.js';
export { NativeBackend } from './backends/native.js';

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

export { SlicerEngine, createSlicerEngine, rankCandidates, CANDIDATE_SORT } from './slicer/index.js';

// Default export: create a configured Ivo instance
import { NativeBackend } from './backends/native.js';
import type { IvoBackend } from './backends/types.js';

export async function createIvo(): Promise<IvoBackend> {
  return new NativeBackend();
}

export default createIvo;
