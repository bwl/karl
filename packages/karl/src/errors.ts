import { TokenUsage } from './types.js';

export class TaskRunError extends Error {
  retryable?: boolean;
  toolsUsed?: string[];
  tokens?: TokenUsage;
  durationMs?: number;
  partialResult?: string;

  constructor(message: string, options?: { retryable?: boolean; toolsUsed?: string[]; tokens?: TokenUsage; durationMs?: number; partialResult?: string }) {
    super(message);
    this.name = 'TaskRunError';
    this.retryable = options?.retryable;
    this.toolsUsed = options?.toolsUsed;
    this.tokens = options?.tokens;
    this.durationMs = options?.durationMs;
    this.partialResult = options?.partialResult;
  }
}

export class TimeoutError extends Error {
  retryable = false;

  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/** A partial answer must never be reported as success or silently replayed. */
export class IncompleteResponseError extends Error {
  retryable = false;
}
