import { createHash } from 'crypto';
import type { TokenUsage } from './types.js';

export interface ComparisonSpec {
  kind: 'karl.comparisonSpec';
  version: 1;
  task: string;
  models: string[];
  contextId?: string;
  timeoutMs?: number;
  maxConcurrency: number;
  output: 'human' | 'json';
  tools: 'none';
  judge?: string;
}

export interface ComparisonInput {
  normalizedTask: string;
  systemPrompt: string;
  systemPromptHash: string;
  contextHash: string;
  inputHash: string;
}

export interface ComparisonCandidateResult {
  model: string;
  status: 'success' | 'error';
  result?: string;
  error?: string;
  durationMs: number;
  tokens?: TokenUsage;
  receiptId: string;
}

export interface ComparisonJudgeResult extends ComparisonCandidateResult {
  rubric: string;
  inputHash: string;
}

export interface ComparisonResult {
  kind: 'karl.comparisonResult';
  version: 1;
  comparisonId: string;
  spec: ComparisonSpec;
  status: 'success' | 'partial' | 'error';
  task: string;
  models: string[];
  contextId?: string;
  contextHash: string;
  systemPromptHash: string;
  inputHash: string;
  maxConcurrency: number;
  candidates: ComparisonCandidateResult[];
  judge?: ComparisonJudgeResult;
  interpretation: 'This is evidence from one prompt/context instance, not a model capability ranking.';
}

export interface ComparisonRunRequest {
  model: string;
  task: string;
  systemPrompt: string;
  inputHash: string;
  contextHash: string;
  timeoutMs?: number;
  role: 'candidate' | 'judge';
  rubric?: string;
}

export type ComparisonRunner = (request: ComparisonRunRequest) => Promise<Omit<ComparisonCandidateResult, 'model'>>;

export function hashComparisonInput(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function normalizeComparisonTask(task: string): string {
  return task.replace(/\r\n/g, '\n').trim();
}

export function validateComparisonSpec(spec: ComparisonSpec): void {
  if (spec.kind !== 'karl.comparisonSpec' || spec.version !== 1) throw new Error('unsupported comparison specification');
  if (!spec.task.trim()) throw new Error('comparison task is required');
  if (spec.models.length < 2) throw new Error('comparison requires at least two models');
  if (new Set(spec.models).size !== spec.models.length) throw new Error('comparison model aliases must be unique');
  if (spec.models.some((model) => !model.trim())) throw new Error('comparison model aliases cannot be empty');
  if (!Number.isInteger(spec.maxConcurrency) || spec.maxConcurrency < 1 || spec.maxConcurrency > 8) {
    throw new Error('comparison max concurrency must be an integer from 1 to 8');
  }
  if (spec.timeoutMs !== undefined && (!Number.isFinite(spec.timeoutMs) || spec.timeoutMs <= 0)) throw new Error('comparison timeout must be positive');
  if (spec.tools !== 'none') throw new Error('comparison runs must disable tools');
}

export function prepareComparisonInput(task: string, systemPrompt: string, contextHash: string): ComparisonInput {
  const normalizedTask = normalizeComparisonTask(task);
  const systemPromptHash = hashComparisonInput(systemPrompt);
  const inputHash = hashComparisonInput(JSON.stringify({ normalizedTask, systemPromptHash, contextHash }));
  return { normalizedTask, systemPrompt, systemPromptHash, contextHash, inputHash };
}

export const COMPARISON_JUDGE_RUBRIC = [
  'Assess each candidate against the same task and context.',
  'Discuss correctness, evidence, completeness, uncertainty, and useful disagreement.',
  'Do not infer a global capability ranking or modify any model configuration.',
].join(' ');

export function buildJudgeTask(task: string, candidates: ComparisonCandidateResult[]): string {
  const evidence = candidates.map((candidate, index) => [
    `Candidate ${index + 1} (${candidate.model}) — ${candidate.status}`,
    candidate.status === 'success'
      ? boundedEvidence(candidate.result ?? '')
      : `Error: ${boundedEvidence(candidate.error ?? 'unknown')}`,
  ].join('\n')).join('\n\n');
  return `Original task:\n${task}\n\nRubric:\n${COMPARISON_JUDGE_RUBRIC}\n\nCandidate evidence:\n${evidence}\n\nProduce a clearly attributed synthesis. Any preference is specific to this one experiment.`;
}

function boundedEvidence(value: string, max = 12_000): string {
  return value.length <= max ? value : `${value.slice(0, max)}\n[comparison evidence truncated]`;
}

export async function executeComparison(
  spec: ComparisonSpec,
  input: ComparisonInput,
  comparisonId: string,
  runner: ComparisonRunner
): Promise<ComparisonResult> {
  validateComparisonSpec(spec);
  const candidates = new Array<ComparisonCandidateResult>(spec.models.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const index = next++;
      if (index >= spec.models.length) return;
      const model = spec.models[index];
      try {
        candidates[index] = { model, ...await runner({
          model, task: input.normalizedTask, systemPrompt: input.systemPrompt,
          inputHash: input.inputHash, contextHash: input.contextHash,
          timeoutMs: spec.timeoutMs, role: 'candidate',
        }) };
      } catch (error) {
        candidates[index] = {
          model, status: 'error', error: (error as Error).message, durationMs: 0,
          receiptId: `${comparisonId}:${model}:unrecorded`,
        };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(spec.maxConcurrency, spec.models.length) }, () => worker()));

  let judge: ComparisonJudgeResult | undefined;
  if (spec.judge) {
    const judgeTask = buildJudgeTask(input.normalizedTask, candidates);
    const judgeInputHash = hashComparisonInput(JSON.stringify({
      task: judgeTask, systemPromptHash: input.systemPromptHash, contextHash: input.contextHash,
    }));
    try {
      judge = {
        model: spec.judge,
        ...await runner({
          model: spec.judge, task: judgeTask, systemPrompt: input.systemPrompt,
          inputHash: judgeInputHash, contextHash: input.contextHash,
          timeoutMs: spec.timeoutMs, role: 'judge', rubric: COMPARISON_JUDGE_RUBRIC,
        }),
        rubric: COMPARISON_JUDGE_RUBRIC,
        inputHash: judgeInputHash,
      };
    } catch (error) {
      judge = {
        model: spec.judge, status: 'error', error: (error as Error).message, durationMs: 0,
        receiptId: `${comparisonId}:${spec.judge}:unrecorded`, rubric: COMPARISON_JUDGE_RUBRIC,
        inputHash: judgeInputHash,
      };
    }
  }

  const succeeded = candidates.filter((candidate) => candidate.status === 'success').length;
  const candidateStatus = succeeded === candidates.length ? 'success' : succeeded === 0 ? 'error' : 'partial';
  const status = judge?.status === 'error' && candidateStatus === 'success' ? 'partial' : candidateStatus;
  return {
    kind: 'karl.comparisonResult', version: 1, comparisonId, spec: { ...spec, models: [...spec.models] },
    status,
    task: input.normalizedTask, models: [...spec.models], contextId: spec.contextId,
    contextHash: input.contextHash, systemPromptHash: input.systemPromptHash, inputHash: input.inputHash,
    maxConcurrency: spec.maxConcurrency, candidates, judge,
    interpretation: 'This is evidence from one prompt/context instance, not a model capability ranking.',
  };
}
