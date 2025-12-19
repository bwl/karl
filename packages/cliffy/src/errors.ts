import { TokenUsage } from './types.js';

export class TaskRunError extends Error {
  retryable?: boolean;
  toolsUsed?: string[];
  tokens?: TokenUsage;
  durationMs?: number;

  constructor(message: string, options?: { retryable?: boolean; toolsUsed?: string[]; tokens?: TokenUsage; durationMs?: number }) {
    super(message);
    this.name = 'TaskRunError';
    this.retryable = options?.retryable;
    this.toolsUsed = options?.toolsUsed;
    this.tokens = options?.tokens;
    this.durationMs = options?.durationMs;
  }
}

export class TimeoutError extends Error {
  retryable = true;

  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}
