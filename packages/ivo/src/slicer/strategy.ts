/**
 * Strategy Plugin Interface — the contract for slicer strategies
 */

import type { IvoBackend } from '../backends/types.js';
import type { SearchMatch } from '../types.js';
import type { SliceAlternate, SliceCandidate, SliceIntensity, SliceRequest } from './types.js';

export interface StrategyContext {
  backend: IvoBackend;
  request: SliceRequest;
  keywords: string[];
  matchedFiles: Set<string>;
  repoRoot: string;
  budgetTokens: number;
  intensity: SliceIntensity;
}

export interface StrategySidecar {
  key: string;
  content: string;
  tokens: number;
}

export interface StrategyResult {
  candidates: SliceCandidate[];
  warnings?: string[];
  sidecar?: StrategySidecar;
}

export interface StrategyPlugin {
  readonly name: string;
  readonly defaultWeight: number;
  readonly defaultBudgetCap?: number;

  /** Check if strategy can run (e.g., embedding index exists, forest CLI available) */
  isAvailable(ctx: StrategyContext): Promise<boolean>;

  /** Execute and return candidates */
  execute(ctx: StrategyContext): Promise<StrategyResult>;
}
