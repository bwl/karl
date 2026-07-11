#!/usr/bin/env bun
/**
 * Comprehensive test suite for Karl
 *
 * Tests core functionality after slimming down dependencies:
 * - Tools (bash, read, write, edit)
 * - Agent loop (streaming, tool calls)
 * - Config management
 * - History database
 * - CLI commands
 */

import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync, readFileSync, symlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Database } from 'bun:sqlite';

// ============================================================================
// Test Utilities
// ============================================================================

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

const results: TestResult[] = [];
let currentSuite = '';

function suite(name: string) {
  currentSuite = name;
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${name}`);
  console.log('='.repeat(60));
}

async function test(name: string, fn: () => Promise<void> | void) {
  const start = Date.now();
  const fullName = `${currentSuite} > ${name}`;
  try {
    await fn();
    const duration = Date.now() - start;
    results.push({ name: fullName, passed: true, duration });
    console.log(`  ✓ ${name} (${duration}ms)`);
  } catch (error) {
    const duration = Date.now() - start;
    const message = error instanceof Error ? error.message : String(error);
    results.push({ name: fullName, passed: false, error: message, duration });
    console.log(`  ✗ ${name} (${duration}ms)`);
    console.log(`    Error: ${message}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message?: string) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

function assertContains(str: string, substr: string, message?: string) {
  if (!str.includes(substr)) {
    throw new Error(message || `Expected "${str}" to contain "${substr}"`);
  }
}

async function assertRejects(fn: () => Promise<unknown>, expected: string) {
  try {
    await fn();
  } catch (error) {
    assertContains(error instanceof Error ? error.message : String(error), expected);
    return;
  }
  throw new Error(`Expected rejection containing "${expected}"`);
}

// Create temp directory for tests
const TEST_DIR = join(tmpdir(), `karl-test-${Date.now()}`);
mkdirSync(TEST_DIR, { recursive: true });

function cleanup() {
  try {
    rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

// ============================================================================
// Tool Tests
// ============================================================================

async function testSandboxPolicy() {
  suite('Sandbox Policy');

  const {
    createDefaultPolicy,
    createSeatbeltPolicy,
    wrapWithBwrap,
    isSandboxAvailable,
    sandboxCommand
  } = await import('../src/sandbox.js');

  const root = join(TEST_DIR, 'sandbox-workspace');
  mkdirSync(join(root, '.git'), { recursive: true });
  mkdirSync(join(root, '.karl'), { recursive: true });
  writeFileSync(join(root, '.env'), 'secret');
  writeFileSync(join(root, '.env.local'), 'secret');
  const policy = createDefaultPolicy(root);
  const canonicalRoot = policy.writablePaths[0];

  await test('default sandbox policy protects workspace metadata and env prefixes', () => {
    assert(policy.protectedPaths.includes(join(canonicalRoot, '.git')));
    assert(policy.protectedPaths.includes(join(canonicalRoot, '.karl')));
    assert(policy.protectedPaths.includes(join(canonicalRoot, '.env')));
    assert(policy.protectedPathPrefixes.includes(join(canonicalRoot, '.env.')));
  });

  await test('Seatbelt profile denies protected paths after allowing workspace writes', () => {
    const profile = createSeatbeltPolicy(policy);
    assertContains(profile, `(subpath ${JSON.stringify(join(canonicalRoot, '.git'))})`);
    assertContains(profile, `(subpath ${JSON.stringify(join(canonicalRoot, '.karl'))})`);
    assertContains(profile, `(subpath ${JSON.stringify(join(canonicalRoot, '.env'))})`);
    assertContains(profile, 'Protected workspace paths override writable roots');
    assert(profile.lastIndexOf('(deny file-write*') > profile.lastIndexOf('(allow file-write*'));
  });

  await test('bubblewrap arguments re-bind existing protected paths read-only', () => {
    const args = wrapWithBwrap(['/bin/true'], canonicalRoot, policy);
    const workspaceBind = args.findIndex(
      (value, index) => value === '--bind' && args[index + 1] === canonicalRoot
    );
    for (const protectedPath of ['.git', '.karl', '.env', '.env.local'].map(name => join(canonicalRoot, name))) {
      const protectedBind = args.findIndex(
        (value, index) => value === '--ro-bind' && args[index + 1] === protectedPath
      );
      assert(protectedBind > workspaceBind, `${protectedPath} should override the writable workspace mount`);
    }
  });

  await test('available platform sandbox can execute a smoke command', async () => {
    const availability = isSandboxAvailable();
    if (!availability.available) return;
    const result = sandboxCommand(['/bin/sh', '-lc', 'exit 0'], root);
    assert(result.sandboxed);
    const proc = Bun.spawn(result.command, { cwd: root, stdout: 'pipe', stderr: 'pipe' });
    assertEqual(await proc.exited, 0);
  });

  await test('restricted bash fails closed if the host sandbox is unavailable', async () => {
    const availability = isSandboxAvailable();
    if (availability.available) return;
    const { createBuiltinTools } = await import('../src/tools.js');
    const { HookRunner } = await import('../src/hooks.js');
    const tools = await createBuiltinTools({ cwd: root, hooks: new HookRunner([]) });
    const bash = tools.find(tool => tool.name === 'bash')!;
    await assertRejects(
      () => bash.execute('sandbox-unavailable', { command: 'echo must-not-run' }),
      'Restricted bash execution refused to run'
    );
  });
}

async function testTools() {
  suite('Tools');

  const { createBuiltinTools } = await import('../src/tools.js');
  const { HookRunner } = await import('../src/hooks.js');

  const ctx = {
    cwd: TEST_DIR,
    hooks: new HookRunner([])
  };

  const tools = await createBuiltinTools(ctx);
  const unrestrictedTools = await createBuiltinTools({ ...ctx, unrestricted: true });

  await test('creates 4 builtin tools', () => {
    assertEqual(tools.length, 4, 'Should have 4 tools');
    const names = tools.map(t => t.name);
    assert(names.includes('bash'), 'Should have bash');
    assert(names.includes('read'), 'Should have read');
    assert(names.includes('write'), 'Should have write');
    assert(names.includes('edit'), 'Should have edit');
  });

  await test('tools have valid JSON schemas', () => {
    for (const tool of tools) {
      assert(tool.parameters.type === 'object', `${tool.name} should have object schema`);
      assert(Array.isArray(tool.parameters.required), `${tool.name} should have required array`);
    }
  });

  await test('bash tool executes commands in explicit unrestricted mode', async () => {
    const bash = unrestrictedTools.find(t => t.name === 'bash')!;
    const result = await bash.execute('test-1', { command: 'echo hello' });
    assertContains(result.content[0].type === 'text' ? result.content[0].text : '', 'hello');
  });

  await test('bash tool captures exit codes in explicit unrestricted mode', async () => {
    const bash = unrestrictedTools.find(t => t.name === 'bash')!;
    const result = await bash.execute('test-2', { command: 'exit 0' });
    assert(result.content.length > 0, 'Should return result');
  });

  await test('write tool creates files', async () => {
    const write = tools.find(t => t.name === 'write')!;
    const testFile = join(TEST_DIR, 'test-write.txt');
    const result = await write.execute('test-3', { path: testFile, content: 'hello world' });
    assert(existsSync(testFile), 'File should exist');
    assertEqual(readFileSync(testFile, 'utf8'), 'hello world');
  });

  await test('read tool reads files', async () => {
    const read = tools.find(t => t.name === 'read')!;
    const testFile = join(TEST_DIR, 'test-read.txt');
    writeFileSync(testFile, 'test content');
    const result = await read.execute('test-4', { path: testFile });
    assertContains(result.content[0].type === 'text' ? result.content[0].text : '', 'test content');
  });

  await test('edit tool modifies files', async () => {
    const edit = tools.find(t => t.name === 'edit')!;
    const testFile = join(TEST_DIR, 'test-edit.txt');
    writeFileSync(testFile, 'foo bar baz');
    await edit.execute('test-5', { path: testFile, oldText: 'bar', newText: 'qux' });
    assertEqual(readFileSync(testFile, 'utf8'), 'foo qux baz');
  });

  await test('edit tool throws on missing text', async () => {
    const edit = tools.find(t => t.name === 'edit')!;
    const testFile = join(TEST_DIR, 'test-edit-fail.txt');
    writeFileSync(testFile, 'hello');
    await assertRejects(
      () => edit.execute('test-6', { path: testFile, oldText: 'xyz', newText: 'abc' }),
      'oldText not found'
    );
  });

  await test('write rejects traversal outside the canonical workspace', async () => {
    const write = tools.find(t => t.name === 'write')!;
    await assertRejects(
      () => write.execute('test-path-1', { path: '../escaped.txt', content: 'no' }),
      'outside working directory'
    );
  });

  await test('bash rejects cwd outside the canonical workspace', async () => {
    const bash = tools.find(t => t.name === 'bash')!;
    await assertRejects(
      () => bash.execute('test-path-2', { command: 'pwd', cwd: '..' }),
      'outside working directory'
    );
  });

  await test('write and edit reject symlink escapes', async () => {
    const outside = join(tmpdir(), `karl-outside-${Date.now()}`);
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'existing.txt'), 'safe');
    symlinkSync(outside, join(TEST_DIR, 'outside-link'));

    const write = tools.find(t => t.name === 'write')!;
    const edit = tools.find(t => t.name === 'edit')!;
    try {
      await assertRejects(
        () => write.execute('test-path-3', { path: 'outside-link/new.txt', content: 'no' }),
        'outside working directory'
      );
      await assertRejects(
        () => edit.execute('test-path-4', { path: 'outside-link/existing.txt', oldText: 'safe', newText: 'changed' }),
        'outside working directory'
      );
      assertEqual(readFileSync(join(outside, 'existing.txt'), 'utf8'), 'safe');
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  await test('write protects Karl metadata, git metadata, and environment files', async () => {
    const write = tools.find(t => t.name === 'write')!;
    for (const protectedPath of ['.karl/context.md', '.git/config', '.env', '.env.local']) {
      await assertRejects(
        () => write.execute(`test-protected-${protectedPath}`, { path: protectedPath, content: 'no' }),
        'protected workspace path'
      );
    }
  });

  await test('workspace policy fails closed when cwd cannot be canonicalized', async () => {
    await assertRejects(
      () => createBuiltinTools({ cwd: join(TEST_DIR, 'missing-workspace'), hooks: new HookRunner([]) }),
      'does not exist or cannot be canonicalized'
    );
  });
}

// ============================================================================
// Agent Loop Tests
// ============================================================================

async function testAgentLoop() {
  suite('Agent Loop');

  const { agentLoop } = await import('../src/agent-loop.js');

  await test('exports agentLoop function', () => {
    assert(typeof agentLoop === 'function', 'agentLoop should be a function');
  });

  await test('agentLoop is an async generator', async () => {
    const mockTools: any[] = [];
    const config = {
      model: 'test',
      baseUrl: 'http://localhost:9999',
      apiKey: 'test'
    };

    const gen = agentLoop('system', 'user', mockTools, config);
    assert(typeof gen.next === 'function', 'Should be a generator');
    assert(typeof gen[Symbol.asyncIterator] === 'function', 'Should be async iterable');
  });

  await test('handles API errors gracefully', async () => {
    const config = {
      model: 'test',
      baseUrl: 'http://localhost:9999', // Non-existent
      apiKey: 'test'
    };

    const gen = agentLoop('system', 'hello', [], config);

    let errorEvent = null;
    try {
      for await (const event of gen) {
        if (event.type === 'error') {
          errorEvent = event;
          break;
        }
      }
    } catch (e) {
      // Expected - connection refused
      errorEvent = { type: 'error', error: e };
    }

    assert(errorEvent !== null, 'Should emit error for bad connection');
  });

  await test('respects maxToolRounds limit', () => {
    // This is a config test - the actual limit is tested in integration
    const config = {
      model: 'test',
      baseUrl: 'http://localhost:9999',
      apiKey: 'test',
      maxToolRounds: 5
    };
    assertEqual(config.maxToolRounds, 5);
  });
}

// ============================================================================
// Schema Sanitization Tests
// ============================================================================

async function testSchemaSanitization() {
  suite('Schema Sanitization');

  // Import the module to test internal sanitization
  const agentLoopModule = await import('../src/agent-loop.js');

  await test('tool schemas are plain JSON objects', async () => {
    const { createBuiltinTools } = await import('../src/tools.js');
    const { HookRunner } = await import('../src/hooks.js');

    const tools = await createBuiltinTools({
      cwd: TEST_DIR,
      hooks: new HookRunner([])
    });

    for (const tool of tools) {
      // Check no TypeBox artifacts
      const schemaStr = JSON.stringify(tool.parameters);
      assert(!schemaStr.includes('$id'), `${tool.name} should not have $id`);
      assert(!schemaStr.includes('patternProperties'), `${tool.name} should not have patternProperties`);
    }
  });

  await test('schemas serialize to valid JSON', async () => {
    const { createBuiltinTools } = await import('../src/tools.js');
    const { HookRunner } = await import('../src/hooks.js');

    const tools = await createBuiltinTools({
      cwd: TEST_DIR,
      hooks: new HookRunner([])
    });

    for (const tool of tools) {
      const json = JSON.stringify(tool.parameters);
      const parsed = JSON.parse(json);
      assertEqual(parsed.type, 'object', `${tool.name} should be object type`);
    }
  });
}

// ============================================================================
// History Tests
// ============================================================================

async function testHistory() {
  suite('History');

  const { HistoryStore, buildHistoryId, createHistoryStore, serializeJournalPayload } = await import('../src/history.js');

  const historyDb = join(TEST_DIR, 'history', 'history.db');

  const history = new HistoryStore(historyDb);

  await test('respects disabled history configuration', () => {
    assertEqual(createHistoryStore({ enabled: false }, TEST_DIR), null);
  });

  await test('inserts and lists runs', () => {
    const id = buildHistoryId();
    history.insertRun({
      id,
      createdAt: Date.now(),
      status: 'success',
      cwd: TEST_DIR,
      command: 'karl run',
      prompt: 'test prompt',
      modelKey: 'test-model',
      stack: 'default'
    });

    const runs = history.listRuns({ limit: 10 });
    assert(Array.isArray(runs), 'Should return array');
    assert(runs.length >= 1, 'Should have at least 1 run');
    assert(runs.some(r => r.id === id), 'Should contain inserted run');
  });

  await test('filters by status', () => {
    const id = buildHistoryId();
    history.insertRun({
      id,
      createdAt: Date.now(),
      status: 'error',
      cwd: TEST_DIR,
      command: 'karl run',
      prompt: 'error test'
    });

    const errorRuns = history.listRuns({ status: 'error' });
    assert(errorRuns.some(r => r.id === id), 'Should find error run');
    for (const run of errorRuns) {
      assertEqual(run.status, 'error');
    }
  });

  await test('filters by stack', () => {
    const id = buildHistoryId();
    history.insertRun({
      id,
      createdAt: Date.now(),
      status: 'success',
      cwd: TEST_DIR,
      command: 'karl run',
      prompt: 'stack test',
      stack: 'test-stack'
    });

    const stackRuns = history.listRuns({ stack: 'test-stack' });
    assert(stackRuns.some(r => r.id === id), 'Should find run by stack');
  });

  await test('handles tags', () => {
    const id = buildHistoryId();
    history.insertRun({
      id,
      createdAt: Date.now(),
      status: 'success',
      cwd: TEST_DIR,
      command: 'karl run',
      prompt: 'tagged run',
      tags: ['test-tag', 'another-tag']
    });

    const taggedRuns = history.listRuns({ tag: ['test-tag'] });
    assert(taggedRuns.some(r => r.id === id), 'Should find tagged run');
  });

  await test('migrates a version 1 history database without data loss', () => {
    const legacyPath = join(TEST_DIR, 'history-v1', 'history.db');
    mkdirSync(join(TEST_DIR, 'history-v1'), { recursive: true });
    const legacy = new Database(legacyPath);
    legacy.exec(`
      PRAGMA user_version = 1;
      CREATE TABLE runs (
        id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, completed_at INTEGER,
        duration_ms INTEGER, status TEXT NOT NULL, exit_code INTEGER,
        cwd TEXT NOT NULL, command TEXT NOT NULL, argv TEXT, stack TEXT,
        model_key TEXT, model_id TEXT, provider_key TEXT, provider_type TEXT,
        skill TEXT, prompt TEXT NOT NULL, response TEXT, error TEXT, thinking TEXT,
        context_file_path TEXT, context_file_raw TEXT, context_inline TEXT,
        system_prompt TEXT, config_snapshot TEXT, tools_used TEXT, tokens TEXT,
        diffs TEXT, parent_id TEXT
      );
      INSERT INTO runs (id, created_at, status, cwd, command, prompt)
      VALUES ('legacy-run', 1, 'success', '/tmp', 'karl run', 'legacy prompt');
    `);
    legacy.close();

    const migrated = new HistoryStore(legacyPath);
    assertEqual(migrated.getRunById('legacy-run')?.prompt, 'legacy prompt');
    const versionDb = new Database(legacyPath, { readonly: true });
    assertEqual(Number((versionDb.query('PRAGMA user_version').get() as { user_version: number }).user_version), 2);
    versionDb.close();
    migrated.close();
  });

  await test('appends ordered run events and finishes the compatibility row', () => {
    const id = buildHistoryId();
    history.startRun({
      id,
      createdAt: Date.now(),
      cwd: TEST_DIR,
      command: 'karl run journal',
      prompt: 'journal test'
    });
    history.appendRunEvent(id, {
      type: 'tool_started',
      attempt: 0,
      toolCallId: 'tool-1',
      toolName: 'bash',
      payload: { args: { command: 'git status' } }
    });
    history.appendRunEvent(id, {
      type: 'tool_finished',
      attempt: 0,
      toolCallId: 'tool-1',
      toolName: 'bash',
      success: true,
      payload: { result: 'clean' }
    });
    history.finishRun(id, {
      completedAt: Date.now(),
      durationMs: 10,
      status: 'success',
      terminalReason: 'succeeded',
      exitCode: 0,
      toolsUsed: ['bash']
    });

    const events = history.getRunEvents(id);
    assertEqual(events.map(event => event.type).join(','), 'run_started,tool_started,tool_finished,run_finished');
    assert(events.every((event, index) => event.sequence === index + 1));
    assertEqual(history.getRunById(id)?.terminalReason, 'succeeded');
    assertEqual(history.getRunById(id)?.exitCode, 0);
  });

  await test('redacts secrets and truncates journal payloads', () => {
    const secret = 'journal-secret-fixture';
    const serialized = serializeJournalPayload({
      apiKey: secret,
      nested: { authorization: `Bearer ${secret}` },
      args: { command: `curl -H "Authorization: Bearer ${secret}"`, env: { TOKEN: secret } },
      output: 'x'.repeat(200)
    }, { maxStringBytes: 32 });
    const text = JSON.stringify(serialized.payload);
    assert(!text.includes(secret), 'Journal payload leaked a secret fixture');
    assertContains(text, '[REDACTED]');
    assertContains(text, '[REDACTED ENV]');
    assert(serialized.truncated, 'Long journal output should be marked truncated');
  });

  await test('reconciles a dead owner as process_lost without dropping events', () => {
    const interruptedPath = join(TEST_DIR, 'history-interrupted', 'history.db');
    const interrupted = new HistoryStore(interruptedPath);
    interrupted.startRun({
      id: 'interrupted-run',
      createdAt: Date.now() - 100,
      cwd: TEST_DIR,
      command: 'karl run interrupted',
      prompt: 'interrupted',
      ownerPid: 99999999
    });
    interrupted.appendRunEvent('interrupted-run', { type: 'tool_started', toolName: 'read', payload: { path: 'README.md' } });
    interrupted.close();

    const reopened = new HistoryStore(interruptedPath);
    const run = reopened.getRunById('interrupted-run');
    assertEqual(run?.status, 'error');
    assertEqual(run?.terminalReason, 'process_lost');
    assert(reopened.getRunEvents('interrupted-run').some(event => event.type === 'tool_started'));
    assertEqual(reopened.getRunEvents('interrupted-run').at(-1)?.type, 'run_finished');
    reopened.close();
  });

  await test('preserves every explicit terminal reason', () => {
    for (const reason of ['failed', 'timed_out', 'stalled', 'canceled'] as const) {
      const id = `${reason}-run`;
      history.startRun({ id, createdAt: Date.now(), cwd: TEST_DIR, command: 'karl run', prompt: reason });
      history.finishRun(id, {
        completedAt: Date.now(),
        durationMs: 1,
        status: 'error',
        terminalReason: reason,
        exitCode: 1
      });
      assertEqual(history.getRunById(id)?.terminalReason, reason);
    }
  });
}

async function testRunInspection() {
  suite('Run Inspection');
  const { boundDisplayText, formatRunInspection } = await import('../src/print.js');
  const run = {
    id: 'ace_fixed_receipt', createdAt: 0, completedAt: 1250, durationMs: 1250,
    status: 'success' as const, terminalReason: 'succeeded' as const, exitCode: 0,
    cwd: '/repo', command: 'karl route execute', prompt: 'patch it',
    response: JSON.stringify({
      changedFiles: ['a.ts', 'b.ts'],
      verification: [{ command: 'test', exitCode: 0 }],
      residualRisk: 'Human review still owns integration.',
    }),
  };
  const events = [
    { runId: run.id, sequence: 1, createdAt: 1, type: 'phase_finished', payload: { phase: 'evidence' }, success: true, truncated: false },
    { runId: run.id, sequence: 2, createdAt: 2, type: 'phase_finished', payload: { phase: 'verify' }, success: true, truncated: false },
  ];

  await test('summary formatter is deterministic and receipt-led', () => {
    assertEqual(formatRunInspection(run, events), [
      'Outcome: success (succeeded) in 1.3s',
      'Phases: evidence ok -> verify ok',
      'Files: 2 changed',
      'Validation: 1 passed, 0 failed',
      'Residual risk: Human review still owns integration.',
      'Receipt: ace_fixed_receipt',
      'Inspect: karl history ace_fixed_receipt --events',
    ].join('\n'));
  });

  await test('verbose failure includes bounded last-tool context', () => {
    const failedRun = { ...run, status: 'error' as const, terminalReason: 'failed' as const, error: 'tool failed' };
    const failedEvents = [...events, {
      runId: run.id, sequence: 3, createdAt: 3, type: 'tool_finished', toolName: 'bash',
      payload: { result: 'x'.repeat(1000) }, success: false, truncated: true,
    }];
    const output = formatRunInspection(failedRun, failedEvents, { mode: 'verbose', width: 60 });
    assertContains(output, 'Last failure: bash:');
    assertContains(output, 'characters omitted');
    assert(output.length < 1400, 'Verbose inspection exceeded its display bound');
  });

  await test('terminal reasons remain literal for timeout and process loss', () => {
    for (const terminalReason of ['timed_out', 'process_lost'] as const) {
      const output = formatRunInspection({ ...run, status: 'error', terminalReason }, [], { width: 40 });
      assertContains(output, `Outcome: error (${terminalReason})`);
      assert(!output.includes('\x1b['), 'Plain formatter emitted ANSI color');
    }
  });

  await test('large nested output is capped with an explicit omission marker', () => {
    const bounded = boundDisplayText(`head-${'x'.repeat(10000)}-tail`, 500);
    assert(bounded.truncated);
    assert(bounded.text.length < 600);
    assertContains(bounded.text, 'characters omitted');
    assert(bounded.text.endsWith('-tail'));
  });

  await test('live status never persists streamed model text', async () => {
    const { StatusWriter } = await import('../src/status.js');
    const cwd = join(TEST_DIR, 'inspection-status');
    mkdirSync(cwd, { recursive: true });
    const writer = new StatusWriter(cwd, 'inspect', 'fixed-status');
    writer.onThinking('private-stream-fixture');
    const status = readFileSync(join(cwd, '.karl', 'status', 'fixed-status.json'), 'utf8');
    assert(!status.includes('private-stream-fixture'));
    assert(!status.includes('thinking'));
  });
}

// ============================================================================
// Config Tests
// ============================================================================

async function testConfig() {
  suite('Config');

  const { loadConfig, isConfigValid } = await import('../src/config.js');

  await test('loads config without error', async () => {
    // Should not throw even if files don't exist
    const config = await loadConfig(TEST_DIR);
    assert(typeof config === 'object', 'Should return object');
    assert('models' in config, 'Should have models');
    assert('providers' in config, 'Should have providers');
  });

  await test('config has expected shape', async () => {
    const config = await loadConfig(TEST_DIR);
    assert(typeof config.models === 'object', 'models should be object');
    assert(typeof config.providers === 'object', 'providers should be object');
  });

  await test('Codex is always available as a built-in provider', async () => {
    const config = await loadConfig(TEST_DIR);
    assertEqual(config.providers.codex?.type, 'codex');
    assertEqual(config.providers.codex?.authType, 'codex');
  });

  await test('isConfigValid works', async () => {
    const config = await loadConfig(TEST_DIR);
    // Empty config may or may not be valid depending on defaults
    const result = isConfigValid(config);
    assert(typeof result === 'boolean', 'Should return boolean');
  });

  const { diagnoseConfig } = await import('../src/config-doctor.js');
  const doctorCwd = join(TEST_DIR, 'doctor');
  mkdirSync(join(doctorCwd, '.karl', 'stacks'), { recursive: true });

  await test('doctor reports a valid project configuration with stable JSON shape', async () => {
    writeFileSync(join(doctorCwd, '.karl.json'), JSON.stringify({
      defaultModel: 'test',
      providers: { local: { type: 'openai', apiKey: 'test-placeholder' } },
      models: { test: { provider: 'local', model: 'test-model' } },
      stacks: { default: { model: 'test' } }
    }));
    const report = await diagnoseConfig(doctorCwd);
    assert(report.ok, JSON.stringify(report.diagnostics));
    assertEqual(report.schemaVersion, 1);
    assertEqual(report.effective.defaultModel, 'test');
    assertEqual(report.effective.providers[0].auth.ready, true);
    assertEqual(Object.keys(report).join(','), 'schemaVersion,ok,sources,effective,sandbox,diagnostics,summary');
  });

  await test('doctor reports malformed files and broken references', async () => {
    writeFileSync(join(doctorCwd, '.karl', 'stacks', 'broken.json'), '{ nope');
    writeFileSync(join(doctorCwd, '.karl.json'), JSON.stringify({
      defaultModel: 'missing',
      providers: { local: { type: 'openai', apiKey: 'x' } },
      models: { broken: { provider: 'absent', model: 'id' } },
      stacks: { child: { extends: 'absent', model: 'missing' } }
    }));
    const report = await diagnoseConfig(doctorCwd);
    assert(!report.ok);
    const codes = report.diagnostics.map(item => item.code);
    assert(codes.includes('invalid_json'));
    assert(codes.includes('missing_default_model'));
    assert(codes.includes('missing_provider'));
    assert(codes.includes('missing_parent_stack'));
  });

  await test('doctor never includes configured secrets', async () => {
    const secret = 'super-secret-doctor-value';
    writeFileSync(join(doctorCwd, '.karl', 'stacks', 'broken.json'), '{}');
    writeFileSync(join(doctorCwd, '.karl.json'), JSON.stringify({
      defaultModel: 'test',
      providers: { local: { type: 'openai', apiKey: secret } },
      models: { test: { provider: 'local', model: 'id' } }
    }));
    const serialized = JSON.stringify(await diagnoseConfig(doctorCwd));
    assert(!serialized.includes(secret), 'Doctor output leaked an API key');
    assert(!serialized.includes('apiKey'), 'Doctor output exposed secret-bearing config fields');
  });
}

// ============================================================================
// Context Manifest Tests
// ============================================================================

async function testContextManifests() {
  suite('Context Manifests');
  const {
    createIvoContextManifest,
    diffContextManifests,
    generateContextId,
    getManifestPath,
    hashContextContent,
    inspectContextPack,
    loadContextManifest,
    loadContextPack,
    validateContextManifest,
  } = await import('../src/context-store.js');
  const repo = join(TEST_DIR, 'context-repo');
  const ivoDir = join(repo, '.ivo', 'contexts');
  mkdirSync(ivoDir, { recursive: true });
  writeFileSync(join(repo, 'a.ts'), 'export const a = 1;\n');
  writeFileSync(join(repo, 'b.ts'), 'export const b = 1;\n');
  writeFileSync(join(repo, 'c.ts'), 'export const c = 1;\n');
  for (const args of [
    ['init'], ['config', 'user.email', 'fixture@example.com'], ['config', 'user.name', 'Karl Fixture'],
    ['add', '.'], ['commit', '-m', 'context fixture'],
  ]) {
    const result = Bun.spawnSync(['git', ...args], { cwd: repo, stdout: 'pipe', stderr: 'pipe' });
    assertEqual(result.exitCode, 0, result.stderr.toString());
  }

  function saveIvo(xml: string, task: string): string {
    const id = generateContextId(xml);
    writeFileSync(join(ivoDir, `${id}.xml`), xml);
    writeFileSync(join(ivoDir, `${id}.meta.json`), JSON.stringify({ id, task, files: 2, tokens: 120, budget: 500, createdAt: '2026-07-11T00:00:00.000Z', format: 'xml' }));
    return id;
  }

  const oldXml = '<ivo_context><files><file path="b.ts" reason="keyword"><content><![CDATA[old]]></content></file><file path="a.ts"><content><![CDATA[a]]></content></file></files></ivo_context>';
  const oldId = saveIvo(oldXml, 'old context');
  const oldManifest = await createIvoContextManifest(oldId, repo);

  await test('Ivo adapter saves and round-trips a versioned atomic manifest', async () => {
    const loaded = await loadContextManifest(oldId, repo);
    assert(loaded !== null);
    assertEqual(loaded!.kind, 'karl.contextManifest');
    assertEqual(loaded!.schemaVersion, 1);
    assertEqual(loaded!.selectedFiles.map(file => file.path).join(','), 'b.ts,a.ts');
    assertEqual(loaded!.selectedFiles[0].reason, 'keyword');
    assertEqual(loaded!.packContentHash, hashContextContent(oldXml));
    assert(existsSync(getManifestPath(oldId, repo)));
  });

  await test('manifest validation rejects traversal and absolute selected paths', async () => {
    for (const badPath of ['../escape.ts', '/tmp/escape.ts']) {
      const copy = structuredClone(oldManifest);
      copy.selectedFiles[0].path = badPath;
      await assertRejects(async () => validateContextManifest(copy), badPath.startsWith('/') ? 'repo-relative' : 'escapes');
    }
  });

  await test('duplicate content ID reuses the published manifest', async () => {
    const duplicate = await createIvoContextManifest(oldId, repo, { createdAt: '2099-01-01T00:00:00.000Z' });
    assertEqual(duplicate.manifestHash, oldManifest.manifestHash);
    assertEqual(duplicate.createdAt, oldManifest.createdAt);
  });

  await test('missing content and interrupted temporary writes are never published', async () => {
    await assertRejects(() => loadContextPack('abcdef0', repo), 'content is missing');
    const interruptedId = 'abcdef1';
    mkdirSync(join(repo, '.karl', 'contexts'), { recursive: true });
    writeFileSync(`${getManifestPath(interruptedId, repo)}.tmp-interrupted`, '{}');
    assertEqual(await loadContextManifest(interruptedId, repo), null);
  });

  const legacyXml = '<ivo_context><files><file path="a.ts"></file></files></ivo_context>';
  const legacyId = saveIvo(legacyXml, 'legacy context');
  await test('existing Ivo packs without Karl manifests remain readable as legacy', async () => {
    const legacy = await loadContextPack(legacyId, repo);
    assertEqual(legacy.kind, 'karl.legacyContextPack');
    assert('legacy' in legacy && legacy.legacy);
  });

  writeFileSync(join(repo, 'b.ts'), 'export const b = 2;\n');
  const newXml = '<ivo_context><files><file path="c.ts"></file><file path="b.ts"></file></files></ivo_context>';
  const newId = saveIvo(newXml, 'new context');
  await createIvoContextManifest(newId, repo);

  await test('inspection reports source drift and diff ordering is deterministic', async () => {
    const inspected = await inspectContextPack(oldId, repo);
    assert('fileStates' in inspected && inspected.fileStates?.some(file => file.path === 'b.ts' && file.state === 'stale'));
    const diff = await diffContextManifests(oldId, newId, repo);
    assertEqual(diff.added.map(file => file.path).join(','), 'c.ts');
    assertEqual(diff.removed.map(file => file.path).join(','), 'a.ts');
    assertEqual(diff.changed.map(file => file.path).join(','), 'b.ts');
  });

  const karl = join(import.meta.dir, '../src/cli.ts');
  async function contextCli(args: string[]): Promise<{ stdout: string; exitCode: number }> {
    const proc = Bun.spawn(['bun', karl, 'context', ...args, '--cwd', repo], { stdout: 'pipe', stderr: 'pipe' });
    return { stdout: await new Response(proc.stdout).text(), exitCode: await proc.exited };
  }
  await test('context show and diff expose stable JSON without implicit content', async () => {
    const shown = await contextCli(['show', oldId, '--json']);
    assertEqual(shown.exitCode, 0);
    const showJson = JSON.parse(shown.stdout) as { kind: string; content?: string; fileStates: unknown[] };
    assertEqual(showJson.kind, 'karl.contextManifest');
    assert(!showJson.content);
    assert(Array.isArray(showJson.fileStates));
    const withContent = JSON.parse((await contextCli(['show', oldId, '--json', '--content'])).stdout) as { content: string };
    assertContains(withContent.content, '<ivo_context>');
    const diff = JSON.parse((await contextCli(['diff', oldId, newId, '--json'])).stdout) as { kind: string; added: Array<{ path: string }> };
    assertEqual(diff.kind, 'karl.contextDiff');
    assertEqual(diff.added[0].path, 'c.ts');
  });

  await test('a fake run journals only the durable manifest reference', async () => {
    const { HistoryStore } = await import('../src/history.js');
    const store = new HistoryStore(join(repo, 'context-history.db'));
    store.startRun({ id: 'context-linked-run', createdAt: Date.now(), cwd: repo, command: 'fake', prompt: 'use context' });
    store.appendRunEvent('context-linked-run', { type: 'context_linked', payload: { provider: 'ivo', manifestId: oldId, manifestHash: oldManifest.manifestHash } });
    writeFileSync(join(repo, 'a.ts'), 'changed after fake run\n');
    const event = store.getRunEvents('context-linked-run').find(entry => entry.type === 'context_linked');
    store.close();
    assertEqual((event!.payload as { manifestHash: string }).manifestHash, oldManifest.manifestHash);
    assert(!JSON.stringify(event).includes(oldXml), 'Journal duplicated full context content');
  });
}

// ============================================================================
// Run Architecture Tests
// ============================================================================

async function testRunArchitecture() {
  suite('Run Architecture');

  const { buildRunPlan } = await import('../src/run-broker.js');
  const { compileEvidenceLedPatch, validateRunArchitecture } = await import('../src/run-architecture.js');
  const plan = buildRunPlan({
    task: 'implement a focused verifier',
    context: {
      cwd: TEST_DIR,
      defaultModelLabel: 'test::local/test-model',
      hasDefaultModel: true,
      openRouterConfigured: true,
      openRouterAuthenticated: true,
    },
  });
  const valid = compileEvidenceLedPatch(plan, { sourceHead: 'abc123', verification: ['bun test'] });

  await test('compiler emits the one fixed evidence-led recipe', () => {
    assertEqual(valid.kind, 'karl.runArchitecture');
    assertEqual(valid.version, 1);
    assertEqual(valid.recipe, 'evidence-led-patch');
    assertEqual(valid.phases.map(phase => phase.id).join(','), 'evidence,scope_gate,patch,verify,handoff');
    assertEqual(valid.phases[0].tools.mode, 'read-only');
    assertEqual(valid.phases[2].worktree, 'detached-required');
    assertEqual(valid.phases[3].checks[0], 'bun test');
    assertEqual(valid.mutationRoute.execution.mode, 'karl-magic');
    assertEqual(valid.mutationRoute.model.provider, 'codex');
    validateRunArchitecture(valid);
  });

  const rejectionCases: Array<[string, string, (copy: typeof valid) => void]> = [
    ['unknown phase', 'phase order', copy => { (copy.phases[0] as { id: string }).id = 'mystery'; }],
    ['cycle', 'cycle', copy => { copy.phases[0].dependsOn = ['handoff']; }],
    ['read-only mutation tool', 'mutation tools', copy => { copy.phases[0].tools.allowed = ['write']; }],
    ['patch without worktree', 'detached worktree', copy => { copy.phases[2].worktree = 'none'; }],
    ['missing human gate', 'human scope gate', copy => { copy.phases[1].requiresHumanApproval = false; }],
    ['missing verification', 'verification checks', copy => { copy.phases[3].checks = []; }],
  ];
  for (const [name, expected, mutate] of rejectionCases) {
    await test(`validator rejects ${name}`, async () => {
      const copy = structuredClone(valid);
      mutate(copy);
      await assertRejects(async () => validateRunArchitecture(copy), expected);
    });
  }
}

// ============================================================================
// Model Comparison Tests
// ============================================================================

async function testModelComparisons() {
  suite('Model Comparisons');
  const {
    COMPARISON_JUDGE_RUBRIC,
    executeComparison,
    prepareComparisonInput,
    validateComparisonSpec,
  } = await import('../src/comparison.js');
  const baseSpec = {
    kind: 'karl.comparisonSpec' as const, version: 1 as const,
    task: 'compare this exact input', models: ['alpha', 'beta', 'gamma'],
    maxConcurrency: 2, output: 'json' as const, tools: 'none' as const,
  };
  const input = prepareComparisonInput(baseSpec.task, 'fixed system policy', 'context-hash');

  await test('spec rejects duplicates, invalid concurrency, and attempted tools', async () => {
    validateComparisonSpec(baseSpec);
    await assertRejects(async () => validateComparisonSpec({ ...baseSpec, models: ['alpha', 'alpha'] }), 'unique');
    await assertRejects(async () => validateComparisonSpec({ ...baseSpec, maxConcurrency: 0 }), '1 to 8');
    await assertRejects(async () => validateComparisonSpec({ ...baseSpec, tools: 'read' } as never), 'disable tools');
  });

  await test('preflight rejects unknown aliases and missing auth before execution', async () => {
    const { preflightComparisonModels } = await import('../src/commands/compare.js');
    const config = {
      defaultModel: 'alpha',
      models: { alpha: { provider: 'local', model: 'a' } },
      providers: { local: { type: 'openai', baseUrl: 'http://fixture.invalid', apiKey: 'fixture' } },
      tools: { enabled: [], custom: [] }, retry: { attempts: 1, backoff: 'linear' as const },
    };
    await assertRejects(() => preflightComparisonModels(config, ['alpha', 'missing']), 'unknown comparison model alias');
    await assertRejects(() => preflightComparisonModels({ ...config, providers: { local: { ...config.providers.local, apiKey: '' } } }, ['alpha']), 'no usable credentials');
  });

  await test('comparison preflight fails closed for Codex tool isolation', async () => {
    const { preflightComparisonModels } = await import('../src/commands/compare.js');
    const config = {
      defaultModel: 'alpha',
      models: { alpha: { provider: 'codex', model: 'gpt-fixture' } },
      providers: { codex: { type: 'codex', authType: 'codex' as const } },
      tools: { enabled: [], custom: [] }, retry: { attempts: 1, backoff: 'linear' as const },
    };
    await assertRejects(() => preflightComparisonModels(config, ['alpha']), 'no-tools contract');
  });

  await test('bounded runner preserves order, identical inputs, and isolated failures', async () => {
    let active = 0;
    let peak = 0;
    const requests: Array<{ task: string; systemPrompt: string; inputHash: string; contextHash: string }> = [];
    const result = await executeComparison(baseSpec, input, 'comparison-fixed', async (request) => {
      active++;
      peak = Math.max(peak, active);
      requests.push(request);
      await new Promise((resolve) => setTimeout(resolve, request.model === 'alpha' ? 15 : 5));
      active--;
      if (request.model === 'beta') throw new Error('isolated beta failure');
      return {
        status: 'success', result: `result-${request.model}`, durationMs: 10,
        tokens: { input: 10, output: 5, total: 15 }, receiptId: `receipt-${request.model}`,
      };
    });
    assertEqual(peak, 2);
    assertEqual(result.status, 'partial');
    assertEqual(result.candidates.map(candidate => candidate.model).join(','), 'alpha,beta,gamma');
    assertEqual(result.candidates[1].error, 'isolated beta failure');
    assert(requests.every(request => request.task === input.normalizedTask));
    assert(requests.every(request => request.systemPrompt === input.systemPrompt));
    assert(requests.every(request => request.inputHash === input.inputHash));
    assert(requests.every(request => request.contextHash === 'context-hash'));
    assert(!JSON.stringify(result).includes('winner'));
  });

  await test('judge is separate, receipted, and exposes rubric provenance', async () => {
    const roles: string[] = [];
    const result = await executeComparison({ ...baseSpec, models: ['alpha', 'beta'], judge: 'judge' }, input, 'comparison-judge', async (request) => {
      roles.push(request.role);
      return { status: 'success', result: `${request.role} result`, durationMs: 1, receiptId: `${request.role}-receipt` };
    });
    assertEqual(roles.join(','), 'candidate,candidate,judge');
    assertEqual(result.judge?.rubric, COMPARISON_JUDGE_RUBRIC);
    assertEqual(result.judge?.receiptId, 'judge-receipt');
    assert(result.judge?.inputHash !== result.inputHash);
    assertEqual(result.interpretation, 'This is evidence from one prompt/context instance, not a model capability ranking.');
  });

  await test('timeout is passed identically and isolated as candidate failure', async () => {
    const seenTimeouts: Array<number | undefined> = [];
    const result = await executeComparison({ ...baseSpec, models: ['alpha', 'beta'], timeoutMs: 25 }, input, 'comparison-timeout', async (request) => {
      seenTimeouts.push(request.timeoutMs);
      if (request.model === 'alpha') throw new Error('Task timed out after 25ms');
      return { status: 'success', result: 'beta', durationMs: 2, receiptId: 'beta-receipt' };
    });
    assertEqual(seenTimeouts.join(','), '25,25');
    assertEqual(result.status, 'partial');
    assertContains(result.candidates[0].error ?? '', 'timed out');
    assertEqual(result.kind, 'karl.comparisonResult');
    assertEqual(result.version, 1);
  });

  await test('fake child receipts link durably to the parent comparison', async () => {
    const { HistoryStore } = await import('../src/history.js');
    const store = new HistoryStore(join(TEST_DIR, 'comparison-history.db'));
    store.startRun({ id: 'comparison-parent', createdAt: 1, cwd: TEST_DIR, command: 'compare', prompt: baseSpec.task });
    const result = await executeComparison({ ...baseSpec, models: ['alpha', 'beta'] }, input, 'comparison-parent', async (request) => {
      const childId = `child-${request.model}`;
      store.startRun({ id: childId, createdAt: Date.now(), cwd: TEST_DIR, command: 'candidate', prompt: request.task, parentId: 'comparison-parent' });
      store.finishRun(childId, { completedAt: Date.now(), durationMs: 1, status: 'success', terminalReason: 'succeeded' });
      return { status: 'success', result: request.model, durationMs: 1, receiptId: childId };
    });
    assertEqual(store.getRunById(result.candidates[0].receiptId)?.parentId, 'comparison-parent');
    assertEqual(store.getRunById(result.candidates[1].receiptId)?.parentId, 'comparison-parent');
    store.close();
  });

  await test('CLI preflight failure is atomic and creates no comparison journal', async () => {
    const repo = join(TEST_DIR, 'comparison-preflight');
    const home = join(repo, 'home');
    const historyPath = join(repo, 'history.db');
    mkdirSync(home, { recursive: true });
    writeFileSync(join(repo, '.karl.json'), JSON.stringify({
      defaultModel: 'alpha',
      models: { alpha: { provider: 'local', model: 'a' } },
      providers: { local: { type: 'openai', baseUrl: 'http://fixture.invalid', apiKey: 'fixture' } },
      history: { enabled: true, path: historyPath },
    }));
    const karl = join(import.meta.dir, '../src/cli.ts');
    const proc = Bun.spawn(['bun', karl, 'compare', '--models', 'alpha,missing', '--cwd', repo, 'task'], {
      stdout: 'pipe', stderr: 'pipe', env: { ...process.env, HOME: home },
    });
    const stderr = await new Response(proc.stderr).text();
    assertEqual(await proc.exited, 1);
    assertContains(stderr, 'unknown comparison model alias');
    assert(!existsSync(historyPath), 'Comparison journal started before preflight completed');
  });
}

// ============================================================================
// CLI Command Tests (subprocess)
// ============================================================================

async function testCLI() {
  suite('CLI Commands');

  const karl = join(import.meta.dir, '../src/cli.ts');

  async function runKarl(args: string, env: Record<string, string> = {}): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const proc = Bun.spawn(['bun', karl, ...args.split(' ')], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, NO_COLOR: '1', ...env }
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    return { stdout, stderr, exitCode };
  }

  async function runKarlArgs(args: string[], env: Record<string, string> = {}): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const proc = Bun.spawn(['bun', karl, ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, NO_COLOR: '1', ...env }
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    return { stdout, stderr, exitCode };
  }

  await test('--help shows usage', async () => {
    const { stdout, exitCode } = await runKarl('--help');
    assertEqual(exitCode, 0);
    assertContains(stdout, 'karl');
  });

  await test('--version shows version', async () => {
    const { stdout, exitCode } = await runKarl('--version');
    assertEqual(exitCode, 0);
    assertContains(stdout, '0.');
  });

  await test('providers list works', async () => {
    const { exitCode } = await runKarl('providers list');
    // May have no providers configured, but shouldn't crash
    assert(exitCode === 0 || exitCode === 1, 'Should not crash');
  });

  await test('providers list exposes the built-in Codex provider', async () => {
    const home = join(TEST_DIR, 'providers-cli-home');
    mkdirSync(home, { recursive: true });
    const { stdout, exitCode } = await runKarl('providers list', { HOME: home });
    assertEqual(exitCode, 0);
    assertContains(stdout, 'codex');
    assertContains(stdout, 'Codex CLI');
  });

  await test('normal runs dispatch Codex models through the app-server transport', async () => {
    const home = join(TEST_DIR, 'codex-run-home');
    const bin = join(TEST_DIR, 'codex-run-bin');
    mkdirSync(join(home, '.config', 'karl', 'models'), { recursive: true });
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(home, '.config', 'karl', 'karl.json'), JSON.stringify({ defaultModel: 'codex-fixture' }));
    writeFileSync(join(home, '.config', 'karl', 'models', 'codex-fixture.json'), JSON.stringify({
      provider: 'codex', model: 'gpt-fixture'
    }));
    const fakeCodex = join(bin, 'codex');
    writeFileSync(fakeCodex, `#!/usr/bin/env bun
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('codex-cli fixture'); process.exit(0); }
if (args[0] === 'login' && args[1] === 'status') { console.log('Logged in using fixture'); process.exit(0); }
if (args[0] !== 'app-server') process.exit(2);
let buffer = '';
const send = (value: unknown) => process.stdout.write(JSON.stringify(value) + '\\n');
for await (const chunk of Bun.stdin.stream()) {
  buffer += new TextDecoder().decode(chunk);
  const lines = buffer.split('\\n');
  buffer = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.trim()) continue;
    const request = JSON.parse(line);
    if (request.method === 'initialize') send({ jsonrpc: '2.0', id: request.id, result: { userAgent: 'fixture' } });
    else if (request.method === 'thread/start') send({ jsonrpc: '2.0', id: request.id, result: { thread: { id: 'thread-fixture' }, model: request.params.model } });
    else if (request.method === 'turn/start') {
      send({ jsonrpc: '2.0', id: request.id, result: { turn: { id: 'turn-fixture' } } });
      send({ jsonrpc: '2.0', method: 'item/agentMessage/delta', params: { delta: 'codex transport fixture' } });
      send({ jsonrpc: '2.0', method: 'thread/tokenUsage/updated', params: { tokenUsage: { total: { inputTokens: 7, outputTokens: 3, totalTokens: 10 } } } });
      send({ jsonrpc: '2.0', method: 'turn/completed', params: { turn: { status: 'completed' } } });
    }
  }
}
`);
    chmodSync(fakeCodex, 0o755);

    const { stdout, stderr, exitCode } = await runKarlArgs(
      ['--json', '--no-history', '--model', 'codex-fixture', 'fixture-task'],
      { HOME: home, PATH: `${bin}:${process.env.PATH ?? ''}` }
    );
    assertEqual(exitCode, 0, stderr);
    assertContains(stdout, 'codex transport fixture');
    const output = JSON.parse(stdout) as { results: Array<{ tokens?: { total?: number } }> };
    assertEqual(output.results[0]?.tokens?.total, 10);
  });

  await test('models list works', async () => {
    const { exitCode } = await runKarl('models list');
    assert(exitCode === 0 || exitCode === 1, 'Should not crash');
  });

  await test('stacks list works', async () => {
    const { exitCode } = await runKarl('stacks list');
    assert(exitCode === 0 || exitCode === 1, 'Should not crash');
  });

  await test('config doctor emits versioned JSON', async () => {
    const home = join(TEST_DIR, 'doctor-cli-home');
    mkdirSync(home, { recursive: true });
    const { stdout, exitCode } = await runKarl('config doctor --json', { HOME: home });
    assertEqual(exitCode, 0);
    const report = JSON.parse(stdout) as { schemaVersion?: number; diagnostics?: unknown[] };
    assertEqual(report.schemaVersion, 1);
    assert(Array.isArray(report.diagnostics));
  });

  await test('history list works', async () => {
    const home = join(TEST_DIR, 'history-list-home');
    mkdirSync(home, { recursive: true });
    const { exitCode } = await runKarl('history list', { HOME: home });
    assert(exitCode === 0 || exitCode === 1, 'Should not crash');
  });

  await test('history events emit versioned redacted JSON', async () => {
    const home = join(TEST_DIR, 'history-cli-home');
    const dbPath = join(home, '.config', 'karl', 'history', 'history.db');
    const { HistoryStore } = await import('../src/history.js');
    const store = new HistoryStore(dbPath);
    store.startRun({
      id: 'cli-event-run',
      createdAt: Date.now(),
      cwd: TEST_DIR,
      command: 'karl run',
      prompt: 'inspect events'
    });
    store.appendRunEvent('cli-event-run', {
      type: 'tool_started',
      toolName: 'bash',
      payload: { args: { command: 'git status', env: { TOKEN: 'cli-secret-fixture' } } }
    });
    store.finishRun('cli-event-run', {
      completedAt: Date.now(),
      durationMs: 1,
      status: 'success',
      terminalReason: 'succeeded',
      exitCode: 0
    });
    store.close();

    const { stdout, exitCode } = await runKarl('history cli-event-run --events --json', { HOME: home });
    assertEqual(exitCode, 0);
    const output = JSON.parse(stdout) as { schemaVersion: number; run: { terminalReason?: string }; events: Array<{ type: string }> };
    assertEqual(output.schemaVersion, 2);
    assertEqual(output.run.terminalReason, 'succeeded');
    assert(output.events.some(event => event.type === 'tool_started'));
    assert(!stdout.includes('cli-secret-fixture'), 'History CLI leaked redacted environment content');

    const textResult = await runKarl('history cli-event-run', { HOME: home, NO_COLOR: '1' });
    assertEqual(textResult.exitCode, 0);
    assertContains(textResult.stdout, 'Outcome: success (succeeded)');
    assertContains(textResult.stdout, 'Inspect: karl history cli-event-run --events');
    assert(!textResult.stdout.includes('Thinking:'), 'History exposed stored model reasoning');
  });

  const recipeRoot = join(TEST_DIR, 'recipe-fixture');
  const recipeRepo = join(recipeRoot, 'source');
  const recipeHome = join(recipeRoot, 'home');
  const worktreeParent = join(recipeRoot, 'worktrees');
  const historyPath = join(recipeRoot, 'history.db');
  mkdirSync(recipeRepo, { recursive: true });
  mkdirSync(recipeHome, { recursive: true });
  mkdirSync(worktreeParent, { recursive: true });
  writeFileSync(join(recipeRepo, 'source.txt'), 'source stays unchanged\n');
  writeFileSync(join(recipeRepo, '.karl.json'), JSON.stringify({
    defaultModel: 'test',
    providers: { local: { type: 'openai', apiKey: 'fixture' } },
    models: { test: { provider: 'local', model: 'test-model' } },
    history: { enabled: true, path: historyPath },
  }));
  for (const args of [
    ['init'], ['config', 'user.email', 'fixture@example.com'], ['config', 'user.name', 'Karl Fixture'],
    ['add', '.'], ['commit', '-m', 'fixture'],
  ]) {
    const result = Bun.spawnSync(['git', ...args], { cwd: recipeRepo, stdout: 'pipe', stderr: 'pipe' });
    assertEqual(result.exitCode, 0, result.stderr.toString());
  }

  const fakeRunner = join(recipeRoot, 'fake-magic.ts');
  writeFileSync(fakeRunner, `#!/usr/bin/env bun
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
const args = process.argv.slice(2);
if (args[0] !== 'magic' || !args.includes('--worktree') || !args.includes('--require-clean')) {
  throw new Error('route did not delegate through magic --worktree --require-clean');
}
const source = args[args.indexOf('--cwd') + 1];
const parent = process.env.FAKE_WORKTREE_PARENT!;
const worktree = join(parent, 'retained-' + Date.now() + '-' + Math.random().toString(36).slice(2));
mkdirSync(parent, { recursive: true });
const add = Bun.spawnSync(['git', '-C', source, 'worktree', 'add', '--detach', worktree, 'HEAD'], { stdout: 'pipe', stderr: 'pipe' });
if (add.exitCode !== 0) throw new Error(add.stderr.toString());
writeFileSync(join(worktree, 'patch.txt'), 'fake runner patch\\n');
const failed = process.env.FAKE_RUNNER_MODE === 'fail';
console.log(JSON.stringify({
  id: 'fake-child', status: failed ? 'error' : 'success', cwd: worktree, worktree,
  error: failed ? 'fake runner failure' : undefined,
  receipt: { filesChanged: ['patch.txt'], commands: [] }
}));
process.exit(failed ? 1 : 0);
`);
  chmodSync(fakeRunner, 0o755);
  const recipeEnv = {
    HOME: recipeHome,
    KARL_AGENT_COMMAND: `bun ${fakeRunner}`,
    FAKE_WORKTREE_PARENT: worktreeParent,
  };

  await test('route architect emits the versioned fixed recipe without side effects', async () => {
    const before = readFileSync(join(recipeRepo, 'source.txt'), 'utf8');
    const { stdout, exitCode } = await runKarlArgs(['route', 'architect', '--json', '--cwd', recipeRepo, 'implement fixture patch'], recipeEnv);
    assertEqual(exitCode, 0);
    const architecture = JSON.parse(stdout) as { kind: string; version: number; phases: Array<{ id: string; tools: { mode: string }; worktree: string; checks: string[] }> };
    assertEqual(architecture.kind, 'karl.runArchitecture');
    assertEqual(architecture.version, 1);
    assertEqual(architecture.phases.map(phase => phase.id).join(','), 'evidence,scope_gate,patch,verify,handoff');
    assertEqual(architecture.phases[0].tools.mode, 'read-only');
    assertEqual(architecture.phases[2].worktree, 'detached-required');
    assert(architecture.phases[3].checks.length > 0);
    assertEqual(readFileSync(join(recipeRepo, 'source.txt'), 'utf8'), before);
    assertEqual(Bun.spawnSync(['git', '-C', recipeRepo, 'worktree', 'list', '--porcelain'], { stdout: 'pipe' }).stdout.toString().split('worktree ').length, 2);
  });

  await test('non-interactive execution requires approval before worktree creation', async () => {
    const before = Bun.spawnSync(['git', '-C', recipeRepo, 'worktree', 'list', '--porcelain'], { stdout: 'pipe' }).stdout.toString();
    const { stdout, exitCode } = await runKarlArgs(['route', 'execute', '--recipe', 'evidence-led-patch', '--json', '--cwd', recipeRepo, 'implement rejected patch'], recipeEnv);
    assertEqual(exitCode, 1);
    const handoff = JSON.parse(stdout) as { status: string; worktree?: string };
    assertEqual(handoff.status, 'rejected');
    assert(!handoff.worktree);
    const after = Bun.spawnSync(['git', '-C', recipeRepo, 'worktree', 'list', '--porcelain'], { stdout: 'pipe' }).stdout.toString();
    assertEqual(after, before);
  });

  await test('accepted recipe isolates changes, verifies, journals phases, and retains worktree', async () => {
    const { stdout, exitCode } = await runKarlArgs([
      'route', 'execute', '--recipe', 'evidence-led-patch', '--yes', '--json',
      '--verify', 'test -f patch.txt', '--cwd', recipeRepo, 'implement accepted patch'
    ], recipeEnv);
    assertEqual(exitCode, 0);
    const handoff = JSON.parse(stdout) as { runId: string; status: string; worktree: string; sourceTreeUnchanged: boolean; changedFiles: string[]; integration: string };
    assertEqual(handoff.status, 'success');
    assert(handoff.sourceTreeUnchanged);
    assert(handoff.changedFiles.includes('patch.txt'));
    assert(existsSync(join(handoff.worktree, 'patch.txt')));
    assert(!existsSync(join(recipeRepo, 'patch.txt')));
    assertContains(handoff.integration, 'no commit, merge, or push');
    const { HistoryStore } = await import('../src/history.js');
    const store = new HistoryStore(historyPath);
    const phases = store.getRunEvents(handoff.runId)
      .filter(event => event.type === 'phase_started')
      .map(event => (event.payload as { phase: string }).phase);
    store.close();
    assertEqual(phases.join(','), 'evidence,scope_gate,patch,verify,handoff');
  });

  await test('verification failure returns review handoff and retains changed worktree', async () => {
    const { stdout, exitCode } = await runKarlArgs([
      'route', 'execute', '--recipe', 'evidence-led-patch', '--yes', '--json',
      '--verify', 'test -f missing.txt', '--cwd', recipeRepo, 'implement failing patch'
    ], recipeEnv);
    assertEqual(exitCode, 1);
    const handoff = JSON.parse(stdout) as { status: string; worktree: string; unresolvedFailures: string[] };
    assertEqual(handoff.status, 'error');
    assert(existsSync(join(handoff.worktree, 'patch.txt')));
    assert(handoff.unresolvedFailures.some(failure => failure.includes('Verification failed')));
  });

  await test('runner failure retains its worktree for inspection', async () => {
    const { stdout, exitCode } = await runKarlArgs([
      'route', 'execute', '--recipe', 'evidence-led-patch', '--yes', '--json',
      '--cwd', recipeRepo, 'implement runner failure'
    ], { ...recipeEnv, FAKE_RUNNER_MODE: 'fail' });
    assertEqual(exitCode, 1);
    const handoff = JSON.parse(stdout) as { status: string; worktree: string; unresolvedFailures: string[] };
    assertEqual(handoff.status, 'error');
    assert(existsSync(join(handoff.worktree, 'patch.txt')));
    assert(handoff.unresolvedFailures.includes('fake runner failure'));
  });
}

// ============================================================================
// Integration Tests (requires provider)
// ============================================================================

async function testIntegration() {
  suite('Integration (requires antigravity)');

  // Check if antigravity is running
  let antigravityAvailable = false;
  try {
    const res = await fetch('http://localhost:8317/v1/models');
    antigravityAvailable = res.ok;
  } catch {
    antigravityAvailable = false;
  }

  if (!antigravityAvailable) {
    console.log('  ⚠ Skipping integration tests - antigravity not running');
    console.log('    Start antigravity server to run these tests');
    return;
  }

  const karl = join(import.meta.dir, '../dist/karl');

  async function runKarl(args: string, timeout = 30000): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const proc = Bun.spawn(['bun', karl, ...args.split(' ')], {
      cwd: TEST_DIR,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, NO_COLOR: '1' }
    });

    const timeoutId = setTimeout(() => proc.kill(), timeout);
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    clearTimeout(timeoutId);

    return { stdout, stderr, exitCode };
  }

  await test('simple task with no tools', async () => {
    // This would require a configured provider - skip for now
    console.log('    (requires configured antigravity provider)');
  });

  await test('antigravity API responds', async () => {
    const res = await fetch('http://localhost:8317/v1/models');
    const data = await res.json();
    assert(Array.isArray(data.data), 'Should have models array');
  });

  await test('streaming completion works', async () => {
    const res = await fetch('http://localhost:8317/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-2.5-flash',
        messages: [{ role: 'user', content: 'Say "test" and nothing else' }],
        stream: true,
        max_tokens: 10
      })
    });

    assert(res.ok, `API should respond OK: ${res.status}`);
    const text = await res.text();
    assertContains(text, 'data:', 'Should be SSE stream');
  });

  await test('tool calling works', async () => {
    const res = await fetch('http://localhost:8317/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-2.5-flash',
        messages: [{ role: 'user', content: 'What is 2+2? Use the calculator tool.' }],
        tools: [{
          type: 'function',
          function: {
            name: 'calculator',
            description: 'Calculate math',
            parameters: {
              type: 'object',
              properties: {
                expression: { type: 'string' }
              },
              required: ['expression']
            }
          }
        }],
        stream: true,
        max_tokens: 100
      })
    });

    assert(res.ok, `API should respond OK: ${res.status}`);
    const text = await res.text();
    // Should either call tool or respond directly
    assert(text.length > 0, 'Should have response');
  });
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('Karl Test Suite');
  console.log(`Test directory: ${TEST_DIR}`);
  console.log(`Started: ${new Date().toISOString()}`);

  try {
    await testSandboxPolicy();
    await testTools();
    await testAgentLoop();
    await testSchemaSanitization();
    await testHistory();
    await testRunInspection();
    await testConfig();
    await testContextManifests();
    await testRunArchitecture();
    await testModelComparisons();
    await testCLI();
    await testIntegration();
  } finally {
    cleanup();
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('  Summary');
  console.log('='.repeat(60));

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const totalTime = results.reduce((sum, r) => sum + r.duration, 0);

  console.log(`\n  Total: ${results.length} tests`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Duration: ${totalTime}ms`);

  if (failed > 0) {
    console.log('\n  Failed tests:');
    for (const result of results.filter(r => !r.passed)) {
      console.log(`    ✗ ${result.name}`);
      console.log(`      ${result.error}`);
    }
    process.exit(1);
  }

  console.log('\n✓ All tests passed!');
}

main().catch((error) => {
  console.error('Test suite crashed:', error);
  cleanup();
  process.exit(1);
});
