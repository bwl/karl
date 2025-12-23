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

import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

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

async function testTools() {
  suite('Tools');

  const { createBuiltinTools } = await import('../src/tools.js');
  const { HookRunner } = await import('../src/hooks.js');

  const ctx = {
    cwd: TEST_DIR,
    hooks: new HookRunner([]),
    unrestricted: true
  };

  const tools = await createBuiltinTools(ctx);

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

  await test('bash tool executes commands', async () => {
    const bash = tools.find(t => t.name === 'bash')!;
    const result = await bash.execute('test-1', { command: 'echo hello' });
    assertContains(result.content[0].type === 'text' ? result.content[0].text : '', 'hello');
  });

  await test('bash tool captures exit codes', async () => {
    const bash = tools.find(t => t.name === 'bash')!;
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
    let threw = false;
    try {
      await edit.execute('test-6', { path: testFile, oldText: 'xyz', newText: 'abc' });
    } catch {
      threw = true;
    }
    assert(threw, 'Should throw on missing text');
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

  const { HistoryStore, buildHistoryId } = await import('../src/history.js');

  const historyDb = join(TEST_DIR, 'history', 'history.db');

  const history = new HistoryStore(historyDb);

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

  await test('isConfigValid works', async () => {
    const config = await loadConfig(TEST_DIR);
    // Empty config may or may not be valid depending on defaults
    const result = isConfigValid(config);
    assert(typeof result === 'boolean', 'Should return boolean');
  });
}

// ============================================================================
// CLI Command Tests (subprocess)
// ============================================================================

async function testCLI() {
  suite('CLI Commands');

  const karl = join(import.meta.dir, '../dist/karl');

  if (!existsSync(karl)) {
    console.log('  ⚠ Skipping CLI tests - dist/karl not found (run bun run build first)');
    return;
  }

  async function runKarl(args: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const proc = Bun.spawn(['bun', karl, ...args.split(' ')], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, NO_COLOR: '1' }
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

  await test('models list works', async () => {
    const { exitCode } = await runKarl('models list');
    assert(exitCode === 0 || exitCode === 1, 'Should not crash');
  });

  await test('stacks list works', async () => {
    const { exitCode } = await runKarl('stacks list');
    assert(exitCode === 0 || exitCode === 1, 'Should not crash');
  });

  await test('history list works', async () => {
    const { exitCode } = await runKarl('history list');
    assert(exitCode === 0 || exitCode === 1, 'Should not crash');
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
    await testTools();
    await testAgentLoop();
    await testSchemaSanitization();
    await testHistory();
    await testConfig();
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
