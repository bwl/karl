/**
 * Slicer exports
 */

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
} from './types.js';

export { BUILTIN_STRATEGIES } from './types.js';

export { SlicerEngine, createSlicerEngine, rankCandidates, CANDIDATE_SORT } from './engine.js';

// Strategy plugin system
export type { StrategyPlugin, StrategyContext, StrategyResult, StrategySidecar } from './strategy.js';
export { registerStrategy, getStrategy, listStrategies, loadExternalStrategies } from './registry.js';
export { registerBuiltinStrategies } from './strategies/index.js';
