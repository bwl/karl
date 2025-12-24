/**
 * Slicer Types - shared context slicing primitives
 */

export type SliceStrategy =
  | 'inventory'
  | 'skeleton'
  | 'keyword'
  | 'symbols'
  | 'ast'
  | 'config'
  | 'diff'
  | 'complexity'
  | 'docs'
  | 'explicit';

export type SliceRepresentation = 'full' | 'snippet' | 'codemap' | 'reference';

export type SliceIntensity = 'lite' | 'standard' | 'deep';

export interface SliceStrategyCaps {
  maxItems?: number;
  maxTokens?: number;
}

export interface SliceRequest {
  task: string;
  repoRoot: string;
  budgetTokens: number;
  warningThreshold?: number;
  intensity?: SliceIntensity;
  strategyIntensity?: Partial<Record<SliceStrategy, SliceIntensity>>;
  strategyCaps?: Partial<Record<SliceStrategy, SliceStrategyCaps>>;
  strategies?: SliceStrategy[];
  includeTree?: boolean;
  include?: string[];
  exclude?: string[];
  maxResults?: number;
}

export interface SliceAlternate {
  representation: SliceRepresentation;
  tokens: number;
  content?: string;
  codemap?: string;
}

export interface SliceCandidate {
  id: string;
  path: string;
  strategy: SliceStrategy;
  representation: SliceRepresentation;
  score: number;
  tokens: number;
  reason: string;
  source: string;
  content?: string;
  codemap?: string;
  alternates?: SliceAlternate[];
}

export interface SliceTree {
  content: string;
  tokens: number;
}

export interface SlicePlan {
  request: SliceRequest;
  candidates: SliceCandidate[];
  strategyTotals: Record<string, { tokens: number; count: number }>;
  warnings: string[];
  tree?: SliceTree;
  totalTokens: number;
}

export interface SliceResult {
  selected: SliceCandidate[];
  totalTokens: number;
  budgetTokens: number;
  context: import('../types.js').ContextResult;
}
