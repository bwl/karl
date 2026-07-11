import path from 'path';
import { buildSystemPrompt } from '../context.js';
import { loadConfig, resolveModel, type ResolvedModel } from '../config.js';
import { hashContextContent, loadContextManifest, readContextContent } from '../context-store.js';
import { buildHistoryId, createHistoryStore, type HistoryStore } from '../history.js';
import { HookRunner } from '../hooks.js';
import { getProviderOAuthToken } from '../oauth.js';
import {
  executeComparison,
  prepareComparisonInput,
  validateComparisonSpec,
  type ComparisonCandidateResult,
  type ComparisonRunRequest,
  type ComparisonSpec,
} from '../comparison.js';
import { runTask } from '../runner.js';
import type { KarlConfig } from '../types.js';
import { formatDuration, parseDurationMs, resolveHomePath } from '../utils.js';
import { TaskRunError } from '../errors.js';
import { boundDisplayText } from '../print.js';

interface CompareOptions {
  models: string[];
  contextId?: string;
  judge?: string;
  timeoutMs?: number;
  maxConcurrency: number;
  json: boolean;
  cwd: string;
  task?: string;
  attemptedTools: boolean;
}

interface PreparedModel {
  resolved: ResolvedModel;
  apiKey: string;
}

function help(): void {
  console.log(`karl compare --models <a,b> [--context <id>] [--judge <model>] [--timeout <duration>] [--max-concurrent <n>] [--json] <task>

Run an explicit no-tools comparison with identical task and context inputs.
Results are evidence from one experiment; Karl does not choose a winner or
change model configuration.`);
}

function parseArgs(args: string[]): CompareOptions {
  const options: CompareOptions = { models: [], maxConcurrency: 2, json: false, cwd: process.cwd(), attemptedTools: false };
  const task: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--models' && args[i + 1]) options.models = args[++i].split(',').map((value) => value.trim()).filter(Boolean);
    else if (arg === '--context' && args[i + 1]) options.contextId = args[++i];
    else if (arg === '--judge' && args[i + 1]) options.judge = args[++i];
    else if (arg === '--timeout' && args[i + 1]) options.timeoutMs = parseDurationMs(args[++i]);
    else if (arg === '--max-concurrent' && args[i + 1]) options.maxConcurrency = Number(args[++i]);
    else if (arg === '--json' || arg === '-j') options.json = true;
    else if (arg === '--cwd' && args[i + 1]) options.cwd = args[++i];
    else if (arg === '--tools' || arg === '--tool' || arg === '--unrestricted') options.attemptedTools = true;
    else if (arg === '--help' || arg === '-h') { help(); process.exit(0); }
    else if (arg.startsWith('-')) throw new Error(`unknown compare flag: ${arg}`);
    else task.push(arg);
  }
  options.task = task.join(' ').trim() || undefined;
  return options;
}

async function resolveCredential(alias: string, resolved: ResolvedModel): Promise<string> {
  const credential = resolved.providerConfig.authType === 'oauth'
    ? await getProviderOAuthToken(resolved.providerKey)
    : resolved.providerConfig.apiKey;
  if (!credential || credential.includes('${')) throw new Error(`model ${alias} has no usable credentials for provider ${resolved.providerKey}`);
  if (!resolved.providerConfig.baseUrl && resolved.providerConfig.type !== 'anthropic') {
    throw new Error(`model ${alias} provider ${resolved.providerKey} has no baseUrl`);
  }
  return credential;
}

export async function preflightComparisonModels(config: KarlConfig, aliases: string[]): Promise<Map<string, PreparedModel>> {
  const prepared = new Map<string, PreparedModel>();
  const uniqueAliases = [...new Set(aliases)];
  const resolvedModels = new Map<string, ResolvedModel>();
  for (const alias of uniqueAliases) {
    if (!config.models[alias]) throw new Error(`unknown comparison model alias: ${alias}`);
    resolvedModels.set(alias, resolveModel(config, { model: alias }));
  }
  for (const alias of uniqueAliases) {
    const resolved = resolvedModels.get(alias)!;
    prepared.set(alias, { resolved, apiKey: await resolveCredential(alias, resolved) });
  }
  return prepared;
}

function finishChild(
  store: HistoryStore,
  childId: string,
  startedAt: number,
  result: Omit<ComparisonCandidateResult, 'model'>
): void {
  const completedAt = Date.now();
  store.finishRun(childId, {
    completedAt,
    durationMs: result.durationMs || completedAt - startedAt,
    status: result.status,
    terminalReason: result.status === 'success' ? 'succeeded' : (result.error ?? '').includes('timed out') ? 'timed_out' : 'failed',
    exitCode: result.status === 'success' ? 0 : 1,
    response: result.result,
    error: result.error,
    tokens: result.tokens,
    toolsUsed: [],
  });
}

function humanCandidate(candidate: ComparisonCandidateResult): void {
  console.log(`\n${candidate.model} — ${candidate.status} — ${formatDuration(candidate.durationMs)}`);
  console.log(`Receipt: ${candidate.receiptId}`);
  if (candidate.tokens) console.log(`Tokens: ${JSON.stringify(candidate.tokens)}`);
  if (candidate.status === 'success') console.log(boundDisplayText(candidate.result ?? '', 12_000).text);
  else console.log(`Error: ${boundDisplayText(candidate.error ?? 'unknown error', 2000).text}`);
}

export async function handleCompareCommand(args: string[]): Promise<void> {
  try {
    const options = parseArgs(args);
    if (!options.task) throw new Error('comparison task is required');
    if (options.attemptedTools) throw new Error('comparison runs must disable tools');
    const cwd = path.resolve(resolveHomePath(options.cwd));
    const spec: ComparisonSpec = {
      kind: 'karl.comparisonSpec', version: 1, task: options.task, models: options.models,
      contextId: options.contextId, timeoutMs: options.timeoutMs,
      maxConcurrency: options.maxConcurrency, output: options.json ? 'json' : 'human',
      tools: 'none', judge: options.judge,
    };
    validateComparisonSpec(spec);

    const config = await loadConfig(cwd);
    const preparedModels = await preflightComparisonModels(config, [...spec.models, ...(spec.judge ? [spec.judge] : [])]);
    let contextHash = hashContextContent('');
    let contextContent: string | undefined;
    let contextManifestHash: string | undefined;
    if (spec.contextId) {
      const manifest = await loadContextManifest(spec.contextId, cwd);
      if (!manifest) throw new Error(`context ${spec.contextId} needs a valid Karl manifest before comparison`);
      contextHash = manifest.packContentHash;
      contextManifestHash = manifest.manifestHash;
      contextContent = await readContextContent(spec.contextId, cwd);
      if (hashContextContent(contextContent) !== manifest.packContentHash) {
        throw new Error(`context ${spec.contextId} content no longer matches its manifest`);
      }
    }
    const systemPrompt = await buildSystemPrompt({ cwd, context: contextContent });
    const input = prepareComparisonInput(spec.task, systemPrompt, contextHash);
    const store = createHistoryStore(config.history, cwd);
    if (!store) throw new Error('comparisons require durable history');
    const comparisonId = buildHistoryId();
    const parentStartedAt = Date.now();
    store.startRun({
      id: comparisonId, createdAt: parentStartedAt, cwd, command: 'karl compare',
      argv: process.argv.slice(2), prompt: input.normalizedTask,
      configSnapshot: { spec, inputHash: input.inputHash, systemPromptHash: input.systemPromptHash, contextHash, contextManifestHash },
      tags: ['comparison'],
    });
    store.appendRunEvent(comparisonId, { type: 'comparison_started', payload: { models: spec.models, maxConcurrency: spec.maxConcurrency, inputHash: input.inputHash, contextId: spec.contextId, contextHash } });
    if (spec.contextId) store.appendRunEvent(comparisonId, { type: 'context_linked', payload: { provider: 'ivo', manifestId: spec.contextId, manifestHash: contextManifestHash } });

    const runner = async (request: ComparisonRunRequest): Promise<Omit<ComparisonCandidateResult, 'model'>> => {
      const model = preparedModels.get(request.model)!;
      const childId = buildHistoryId();
      const startedAt = Date.now();
      store.startRun({
        id: childId, createdAt: startedAt, cwd, command: `karl compare ${request.role}`,
        prompt: request.task, modelKey: model.resolved.modelKey, modelId: model.resolved.model,
        providerKey: model.resolved.providerKey, providerType: model.resolved.providerConfig.type,
        configSnapshot: { role: request.role, inputHash: request.inputHash, contextHash: request.contextHash, rubric: request.rubric, tools: 'none' },
        parentId: comparisonId, tags: ['comparison', request.role],
      });
      store.appendRunEvent(comparisonId, { type: `${request.role}_started`, payload: { model: request.model, childId, inputHash: request.inputHash } });
      if (spec.contextId) store.appendRunEvent(childId, { type: 'context_linked', payload: { provider: 'ivo', manifestId: spec.contextId, manifestHash: contextManifestHash } });
      let childResult: Omit<ComparisonCandidateResult, 'model'>;
      try {
        const result = await runTask({
          task: request.task, index: spec.models.indexOf(request.model), attempt: 1, cwd,
          model: model.resolved.model, providerKey: model.resolved.providerKey,
          providerType: model.resolved.providerConfig.type, apiKey: model.apiKey,
          baseUrl: model.resolved.providerConfig.baseUrl, systemPrompt: request.systemPrompt,
          hooks: new HookRunner([]), toolsConfig: { enabled: [], custom: [] }, noTools: true,
          timeoutMs: request.timeoutMs, maxTokens: model.resolved.maxTokens,
          requestBody: model.resolved.request, contextLength: model.resolved.contextLength,
        });
        childResult = { status: 'success', result: result.result, durationMs: result.durationMs, tokens: result.tokens, receiptId: childId };
      } catch (error) {
        const taskError = error as TaskRunError;
        childResult = { status: 'error', error: taskError.message, durationMs: taskError.durationMs ?? Date.now() - startedAt, tokens: taskError.tokens, receiptId: childId };
      }
      finishChild(store, childId, startedAt, childResult);
      store.appendRunEvent(comparisonId, { type: `${request.role}_finished`, success: childResult.status === 'success', payload: { model: request.model, childId, durationMs: childResult.durationMs, tokens: childResult.tokens, error: childResult.error } });
      return childResult;
    };

    const result = await executeComparison(spec, input, comparisonId, runner);
    const completedAt = Date.now();
    const parentStatus = result.status === 'error' ? 'error' : 'success';
    store.finishRun(comparisonId, {
      completedAt, durationMs: completedAt - parentStartedAt, status: parentStatus,
      terminalReason: parentStatus === 'success' ? 'succeeded' : 'failed', exitCode: parentStatus === 'success' ? 0 : 1,
      response: JSON.stringify({
        kind: result.kind, version: result.version, status: result.status,
        candidates: result.candidates.map((candidate) => ({ model: candidate.model, status: candidate.status, receiptId: candidate.receiptId })),
        judge: result.judge ? { model: result.judge.model, status: result.judge.status, receiptId: result.judge.receiptId, rubric: result.judge.rubric } : undefined,
        inputHash: result.inputHash, contextHash: result.contextHash, interpretation: result.interpretation,
      }),
    });
    store.close();

    if (options.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`Comparison: ${comparisonId}`);
      console.log(`Input: ${result.inputHash}`);
      console.log(`Context: ${result.contextId ?? 'none'} (${result.contextHash})`);
      for (const candidate of result.candidates) humanCandidate(candidate);
      if (result.judge) {
        console.log(`\nJudge synthesis (${result.judge.model}; model-generated, separately receipted)`);
        console.log(`Rubric: ${result.judge.rubric}`);
        humanCandidate(result.judge);
      }
      console.log(`\n${result.interpretation}`);
    }
    if (result.status === 'error') process.exitCode = 1;
  } catch (error) {
    console.error(`compare error: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
