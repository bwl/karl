import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { agentLoop, type AgentLoopConfig, type ToolDefinition } from '../src/agent-loop.js';
import { resolveModel } from '../src/config.js';
import { runTask } from '../src/runner.js';
import { HookRunner } from '../src/hooks.js';
import { TaskRunError } from '../src/errors.js';
import { readSSE } from '../src/sse.js';
import type { KarlConfig } from '../src/types.js';

const servers: ReturnType<typeof Bun.serve>[] = [];
const directories: string[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const frame = (value: unknown) => `data: ${JSON.stringify(value)}\r\n\r\n`;
const choice = (delta: object, finish_reason: string | null = null, native_finish_reason?: string) => ({
  choices: [{ index: 0, delta, finish_reason, native_finish_reason }],
});
const checkpoint = (data: string) => ({
  type: 'reasoning.encrypted', id: 'gemini-continuation', format: 'google-gemini-v1', index: 0, data,
});

function sse(...chunks: unknown[]): Response {
  const bytes = new TextEncoder().encode(': OPENROUTER PROCESSING\r\n\r\n' + chunks.map(frame).join('') + 'data: [DONE]\r\n\r\n');
  let offset = 0;
  return new Response(new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(offset, offset + 8191));
      offset += 8191;
    },
  }), { headers: { 'Content-Type': 'text/event-stream' } });
}

function serverFor(handler: (body: any, index: number) => Response | Promise<Response>) {
  const requests: any[] = [];
  const server = Bun.serve({
    port: 0, hostname: '127.0.0.1', idleTimeout: 0,
    async fetch(request) {
      const body = await request.json();
      requests.push(body);
      return handler(body, requests.length - 1);
    },
  });
  servers.push(server);
  return { requests, baseUrl: `http://127.0.0.1:${server.port}` };
}

async function collect(config: Partial<AgentLoopConfig>, context = 'system', tools: ToolDefinition[] = []) {
  const loop = agentLoop(context, 'Analyze this carefully.', tools, {
    model: 'google/gemini-4-argon', apiKey: 'fixture', baseUrl: '', ...config,
  });
  while (true) {
    const step = await loop.next();
    if (step.done) return step.value;
  }
}

describe('OpenRouter long responses', () => {
  test('resumes reasoning-only hops, keeps large context and latest opaque token, joins text and accounts for every hop', async () => {
    const context = 'context-start\n' + 'alpha '.repeat(240_000) + '\ncontext-end';
    const token = checkpoint('opaque-'.repeat(170_000));
    const api = serverFor((_, index) => {
      if (index === 0) return sse(
        choice({ reasoning_details: [checkpoint('old-checkpoint')] }),
        choice({ reasoning_details: [token] }, 'length', 'CONTINUATION'),
        { ...choice({}, 'length', 'CONTINUATION'), usage: { prompt_tokens: 240_000, completion_tokens: 65_536, total_tokens: 305_536, cost: 1 } },
      );
      if (index === 1) return sse(
        choice({ content: 'Substantive ', reasoning_details: [checkpoint('second')] }, 'length', 'CONTINUATION'),
        { choices: [], usage: { prompt_tokens: 305_536, completion_tokens: 65_536, total_tokens: 371_072, cost: 2 } },
      );
      return sse(
        choice({ content: 'answer ✓', reasoning_details: [checkpoint('completed')] }, 'stop'),
        { ...choice({}, 'stop'), usage: { prompt_tokens: 371_072, completion_tokens: 100, total_tokens: 371_172, cost: 3 } },
      );
    });
    const result = await collect({ baseUrl: api.baseUrl, maxTokens: 262_144, requestBody: { reasoning: { effort: 'high', exclude: true } } }, context);
    expect(result.message.content).toBe('Substantive answer ✓');
    expect(result.usage).toEqual({ input: 916_608, output: 131_172, total: 1_047_780, cost: 6 });
    expect(api.requests).toHaveLength(3);
    for (const body of api.requests) {
      expect(body.messages[0].content).toBe(context);
      expect(body.max_tokens).toBe(262_144);
      expect(body.reasoning).toEqual({ effort: 'high', exclude: true });
    }
    expect(api.requests[1].messages).toEqual([...api.requests[0].messages, { role: 'assistant', content: '', reasoning_details: [token] }]);
    expect(api.requests[2].messages).toEqual([...api.requests[0].messages, { role: 'assistant', content: '', reasoning_details: [checkpoint('second')] }]);
    expect(result.message.reasoning_details).toBeUndefined();
  });

  test('does not increase a spent budget or lose partial text and usage', async () => {
    const api = serverFor(() => sse(
      choice({ content: 'Partial result', reasoning_details: [checkpoint('spent')] }, 'length', 'MAX_TOKENS'),
      { choices: [], usage: { prompt_tokens: 200_000, completion_tokens: 65_536, total_tokens: 265_536 } },
    ));
    let error: TaskRunError | undefined;
    try { await collect({ baseUrl: api.baseUrl, maxTokens: 65_536 }); } catch (caught) { error = caught as TaskRunError; }
    expect(error?.message).toContain('--max-tokens');
    expect(error?.partialResult).toBe('Partial result');
    expect(error?.tokens?.output).toBe(65_536);
    expect(error?.retryable).toBe(false);
    expect(api.requests).toHaveLength(1);
  });

  test.each([
    ['missing continuation', [choice({ content: 'partial' }, 'length', 'CONTINUATION')], 'output limit'],
    ['ordinary length limit', [choice({ content: 'partial' }, 'length')], 'output limit'],
    ['filtered response', [choice({ content: 'partial' }, 'content_filter')], 'content_filter'],
    ['missing finish', [choice({ content: 'partial' })], 'without a finish reason'],
    ['provider error', [{ error: { message: 'provider unavailable' } }], 'provider unavailable'],
    ['empty answer', [choice({}, 'stop')], 'no answer'],
  ])('%s fails instead of reporting success', async (_, frames, message) => {
    const api = serverFor(() => sse(...frames));
    await expect(collect({ baseUrl: api.baseUrl, maxTokens: 262_144 })).rejects.toThrow(message);
    expect(api.requests).toHaveLength(1);
  });

  test('a continuation cannot exceed the chosen cumulative budget', async () => {
    const api = serverFor(() => sse(
      choice({ reasoning_details: [checkpoint('next')] }, 'length', 'CONTINUATION'),
      { choices: [], usage: { completion_tokens: 65_536 } },
    ));
    await expect(collect({ baseUrl: api.baseUrl, maxTokens: 65_536 })).rejects.toThrow('remaining output budget');
    expect(api.requests).toHaveLength(1);
  });

  test('bounds continuation hops even if the provider omits usage', async () => {
    const api = serverFor(() => sse(choice({ reasoning_details: [checkpoint('next')] }, 'length', 'CONTINUATION')));
    await expect(collect({ baseUrl: api.baseUrl, maxTokens: 262_144 })).rejects.toThrow('32 continuation hops');
    expect(api.requests).toHaveLength(33);
  });

  test('preserves tool-call text and opaque reasoning signatures across turns', async () => {
    let executions = 0;
    const signature = { type: 'reasoning.encrypted', id: 'thought-signature', format: 'google-gemini-v1', index: 0, data: 'opaque-signature' };
    const api = serverFor((_, index) => index === 0 ? sse(
      choice({ content: 'Reading.', reasoning_details: [{ ...signature, data: 'opaque-' }], tool_calls: [{ index: 0, id: 'call-1', function: { name: 'read', arguments: '{"path":' } }] }),
      choice({ reasoning_details: [{ index: 0, data: 'signature' }], tool_calls: [{ index: 0, function: { arguments: '"notes"}' } }] }, 'tool_calls'),
      choice({}, 'tool_calls'),
    ) : sse(choice({ content: 'Finished.' }, 'stop')));
    const result = await collect({ baseUrl: api.baseUrl }, 'system', [{
      name: 'read', description: 'Read notes', parameters: { type: 'object' },
      async execute(_, params) { executions++; expect(params.path).toBe('notes'); return { content: [{ type: 'text', text: 'notes' }] }; },
    }]);
    expect(result.message.content).toBe('Finished.');
    expect(executions).toBe(1);
    expect(api.requests[1].messages[2].reasoning_details).toEqual([signature]);
    expect(api.requests[1].messages[2].content).toBe('Reading.');
  });

  test('never executes truncated tool arguments', async () => {
    let executions = 0;
    const api = serverFor(() => sse(choice({ tool_calls: [{ index: 0, id: 'call', function: { name: 'write', arguments: '{"path":' } }] }, 'tool_calls')));
    await expect(collect({ baseUrl: api.baseUrl }, 'system', [{
      name: 'write', description: 'Write file', parameters: {},
      async execute() { executions++; return { content: [] }; },
    }])).rejects.toThrow('incomplete tool arguments');
    expect(executions).toBe(0);
  });

  test('malformed data is an error, not a silently omitted part of the answer', async () => {
    const api = serverFor(() => new Response(frame(choice({ content: 'prefix' })) + 'data: {bad json}\n\n' + frame(choice({ content: 'suffix' }, 'stop'))));
    await expect(collect({ baseUrl: api.baseUrl })).rejects.toThrow('malformed stream data');
  });

  test('DONE terminates a completed response even when the connection stays open', async () => {
    const api = serverFor(() => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(frame(choice({ content: 'Complete.' }, 'stop')) + 'data: [DONE]\n\n'));
    } }), { headers: { 'Content-Type': 'text/event-stream' } }));
    const result = await collect({ baseUrl: api.baseUrl, signal: AbortSignal.timeout(2000) });
    expect(result.message.content).toBe('Complete.');
  });

  test('SSE handles split Unicode, CRLF, comments, multiline JSON and final unterminated event', async () => {
    const bytes = new TextEncoder().encode(': keepalive\r\n\r\ndata: {\r\ndata: "text": "✓"}\r\n\r\ndata: final');
    let offset = 0;
    const body = new ReadableStream<Uint8Array>({ pull(controller) {
      if (offset === bytes.length) return controller.close();
      controller.enqueue(bytes.slice(offset, ++offset));
    } });
    const events = [];
    for await (const data of readSSE(body)) events.push(data);
    expect(events).toEqual(['{\n"text": "✓"}', 'final']);
  });

  test('aborting a long request returns promptly and is not retryable', async () => {
    const api = serverFor(() => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(frame(choice({ content: 'partial' }))));
    } }), { headers: { 'Content-Type': 'text/event-stream' } }));
    const cwd = mkdtempSync(join(tmpdir(), 'karl-timeout-')); directories.push(cwd);
    const start = Date.now();
    let error: TaskRunError | undefined;
    try {
      await runTask({
        task: 'test', index: 0, attempt: 0, cwd, model: 'test', providerKey: 'fixture', providerType: 'openai',
        apiKey: 'fixture', baseUrl: api.baseUrl, systemPrompt: '', noTools: true,
        hooks: await HookRunner.load(cwd), toolsConfig: { enabled: [], custom: [] }, timeoutMs: 100,
      });
    } catch (caught) { error = caught as TaskRunError; }
    expect(error?.message).toContain('timed out');
    expect(error?.partialResult).toBe('partial');
    expect(error?.retryable).toBe(false);
    expect(Date.now() - start).toBeLessThan(2000);
  });
});

describe('large-input CLI', () => {
  function fixture(baseUrl: string) {
    const cwd = mkdtempSync(join(tmpdir(), 'karl-large-input-')); directories.push(cwd);
    const testHome = join(cwd, 'home'); mkdirSync(testHome);
    const config: KarlConfig = {
      defaultModel: 'small',
      models: { small: { provider: 'other', model: 'small-model', maxTokens: 32, contextLength: 128_000, request: { temperature: 0.1 } } },
      providers: { other: { type: 'openai', baseUrl: 'http://127.0.0.1:1', apiKey: 'fixture' }, openrouter: { type: 'openai', baseUrl, apiKey: 'fixture' } },
      tools: { enabled: [], custom: [] }, retry: { attempts: 3, backoff: 'linear' }, history: { enabled: true, path: join(cwd, 'history.db') },
    };
    writeFileSync(join(cwd, '.karl.json'), JSON.stringify(config));
    return { cwd, config, env: { ...process.env, HOME: testHome, KARL_JOB_ID: '', NO_COLOR: '1' } };
  }
  const cli = resolve(import.meta.dir, '../src/cli.ts');
  const flags = ['run', '--provider', 'openrouter', '--model', 'google/gemini-4-argon', '--no-tools', '--json'];
  async function run(f: ReturnType<typeof fixture>, args: string[], stdin = '') {
    const command = process.env.KARL_TEST_EXECUTABLE ? [process.env.KARL_TEST_EXECUTABLE, ...args] : [process.execPath, cli, ...args];
    const proc = Bun.spawn(command, {
      cwd: f.cwd, env: f.env, stdin: new Blob([stdin]), stdout: 'pipe', stderr: 'pipe',
    });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test('pipes >1MB alongside an explicit task and sends CLI controls to the selected provider', async () => {
    const api = serverFor(() => sse(choice({ content: 'Analysis complete.' }, 'stop')));
    const f = fixture(api.baseUrl);
    const input = 'BEGIN\n' + 'alpha '.repeat(240_000) + '\nEND';
    const result = await run(f, [...flags, '--max-tokens', '262144', '--reasoning-effort', 'high', '--timeout', '2h', 'Analyze all the context.'], input);
    expect(result.exitCode).toBe(0);
    expect(api.requests).toHaveLength(1);
    expect(api.requests[0].messages[0].content).toContain(input);
    expect(api.requests[0].messages[1].content).toBe('Analyze all the context.');
    expect(api.requests[0].max_tokens).toBe(262_144);
    expect(api.requests[0].reasoning).toEqual({ effort: 'high' });
    expect(api.requests[0].temperature).toBeUndefined();
    expect(JSON.parse(result.stdout).results[0].result).toBe('Analysis complete.');
  });

  test('raw IDs do not inherit another model’s output limit, context metadata or request defaults', () => {
    const f = fixture('http://unused');
    const model = resolveModel(f.config, { model: 'google/gemini-4-argon' });
    expect(model.maxTokens).toBeUndefined();
    expect(model.contextLength).toBeUndefined();
    expect(model.request).toBeUndefined();
    expect(model.modelKey).toBe('google/gemini-4-argon');
    expect(resolveModel(f.config, { provider: 'openrouter', model: 'google/gemini-4-argon' }).providerKey).toBe('openrouter');
  });

  test('explicit file context is sent in full, with no Karl timeout when set to zero', async () => {
    const api = serverFor(() => sse(choice({ content: 'ok' }, 'stop')));
    const f = fixture(api.baseUrl);
    const input = 'word '.repeat(240_000);
    writeFileSync(join(f.cwd, 'context.txt'), input);
    const result = await run(f, [...flags, '--context-file', 'context.txt', '--timeout', '0', 'Analyze.']);
    expect(result.exitCode).toBe(0);
    expect(api.requests[0].messages[0].content).toContain(input.trim());
  });

  test('missing context fails before making a paid request', async () => {
    const api = serverFor(() => sse(choice({ content: 'should not run' }, 'stop')));
    const result = await run(fixture(api.baseUrl), [...flags, '--context-file', 'missing.txt', 'Analyze.']);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Cannot read context file');
    expect(api.requests).toHaveLength(0);
  });

  test('empty stdin context fails before making a paid request', async () => {
    const api = serverFor(() => sse(choice({ content: 'should not run' }, 'stop')));
    const result = await run(fixture(api.baseUrl), [...flags, '--context-file', '-', 'Analyze.']);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('No context received');
    expect(api.requests).toHaveLength(0);
  });

  test('CLI output and reasoning overrides beat stack defaults without dropping other reasoning options', async () => {
    const api = serverFor(() => sse(choice({ content: 'ok' }, 'stop')));
    const f = fixture(api.baseUrl);
    f.config.stacks = { analysis: {
      model: 'small', maxTokens: 262_144, timeout: 30_000, noTools: true,
      request: { max_tokens: 131_072, reasoning: { effort: 'high', exclude: true } },
    } };
    writeFileSync(join(f.cwd, '.karl.json'), JSON.stringify(f.config));
    const result = await run(f, [...flags, '--stack', 'analysis', '--max-tokens', '16384', '--reasoning-effort', 'medium', '--timeout', '0', 'Analyze.']);
    expect(result.exitCode).toBe(0);
    expect(api.requests[0].max_tokens).toBe(16_384);
    expect(api.requests[0].reasoning).toEqual({ effort: 'medium', exclude: true });
  });

  test('CLI task deadline stops once, preserving partial output', async () => {
    const api = serverFor(() => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(frame(choice({ content: 'partial' }))));
    } }), { headers: { 'Content-Type': 'text/event-stream' } }));
    const result = await run(fixture(api.baseUrl), [...flags, '--timeout', '100ms', 'Analyze.']);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).results[0].result).toBe('partial');
    expect(api.requests).toHaveLength(1);
  });

  test('nested commands cannot finish a background job owned by another process', async () => {
    const { finishBackgroundJob } = await import('../src/jobs.js');
    const f = fixture('http://unused');
    const jobId = 'job_fixture';
    const jobDir = join(f.cwd, '.karl', 'jobs', jobId);
    mkdirSync(jobDir, { recursive: true });
    const meta = { id: jobId, pid: process.pid + 1, status: 'running' };
    writeFileSync(join(jobDir, 'meta.json'), JSON.stringify(meta));
    finishBackgroundJob(f.cwd, jobId, 0);
    expect(JSON.parse(readFileSync(join(jobDir, 'meta.json'), 'utf8'))).toEqual(meta);
  });

  test.each([['--max-tokens', '0'], ['--max-tokens', '1.5'], ['--reasoning-effort', 'bogus'], ['--timeout', '1..2h'], ['--timeout', '999999h']])('rejects invalid %s %s', async (flag, value) => {
    const api = serverFor(() => sse(choice({ content: 'should not run' }, 'stop')));
    const result = await run(fixture(api.baseUrl), [...flags, flag, value, 'Analyze.']);
    expect(result.exitCode).toBe(1);
    expect(api.requests).toHaveLength(0);
  });

  test('CLI retains an incomplete answer in JSON and history, and does not retry a stream error', async () => {
    const api = serverFor(() => sse(choice({ content: 'Partial answer.' }), { error: { message: 'temporary provider timeout' } }));
    const f = fixture(api.baseUrl);
    const result = await run(f, [...flags, 'Analyze.']);
    expect(result.exitCode).toBe(1);
    const payload = JSON.parse(result.stdout);
    expect(payload.results[0].status).toBe('error');
    expect(payload.results[0].result).toBe('Partial answer.');
    expect(api.requests).toHaveLength(1);
    const { HistoryStore } = await import('../src/history.js');
    const store = new HistoryStore(join(f.cwd, 'history.db'));
    expect(store.getRunById(payload.history_id)?.response).toBe('Partial answer.');
    store.close();
  });

  test.each([
    ['--background', ['Analyze.']],
    ['--bg', ['--context-file', '-', 'Analyze.']],
    ['--detach', ['-']],
    ['--background', ['--context', '--bg', 'Analyze.']],
  ])('background %s retains stdin and records completion after the parent exits', async (background, args) => {
    const api = serverFor(async () => {
      await Bun.sleep(250);
      return sse(choice({ content: 'Background analysis.' }, 'stop'));
    });
    const f = fixture(api.baseUrl);
    const input = 'BEGIN ' + 'alpha '.repeat(240_000) + ' END';
    const result = await run(f, [...flags, background, ...args], input);
    expect(result.exitCode).toBe(0);
    const jobId = result.stdout.match(/Job started: (job_\w+)/)?.[1];
    expect(jobId).toBeTruthy();
    const jobDir = join(f.cwd, '.karl', 'jobs', jobId!);
    let meta: any;
    for (let attempt = 0; attempt < 100; attempt++) {
      meta = JSON.parse(readFileSync(join(jobDir, 'meta.json'), 'utf8'));
      if (meta.status !== 'running') break;
      await Bun.sleep(50);
    }
    expect(meta.status).toBe('completed');
    expect(meta.exitCode).toBe(0);
    expect(api.requests).toHaveLength(1);
    expect(JSON.stringify(api.requests[0].messages)).toContain(input);
    expect(JSON.parse(readFileSync(join(jobDir, 'output.log'), 'utf8')).results[0].result).toBe('Background analysis.');
  });
});
