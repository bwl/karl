/**
 * Thin protocol client for `codex app-server` (JSON-RPC over JSONL/stdio).
 *
 * Spawns the app-server as a child process, handles the bidirectional
 * JSON-RPC protocol, auto-approves tool calls, and exposes a streaming
 * async generator for turn events.
 */

import type { Subprocess } from 'bun';

// ── Event types emitted to the command handler ──────────────────────────

export type CodexEvent =
  | { type: 'agent_message_delta'; text: string }
  | { type: 'reasoning_delta'; text: string }
  | { type: 'command_start'; command: string; cwd: string; itemId: string }
  | { type: 'command_output_delta'; delta: string; itemId: string }
  | { type: 'command_end'; command: string; exitCode: number | null; durationMs: number | null; itemId: string }
  | { type: 'file_change'; itemId: string; status: string; filePath?: string }
  | { type: 'plan_delta'; text: string }
  | { type: 'turn_diff'; diff: string }
  | { type: 'token_usage'; total: number; input: number; output: number; cached: number; reasoning: number }
  | { type: 'error'; message: string; willRetry: boolean }
  | { type: 'turn_completed'; status: string; lastMessage: string | null; error?: string };

// ── Client options ──────────────────────────────────────────────────────

export interface CodexClientOptions {
  cwd: string;
  model?: string;
  instructions?: string;
  approvalPolicy?: 'untrusted' | 'on-failure' | 'on-request' | 'never';
  effort?: string;
  outputSchema?: unknown;
  ephemeral?: boolean;
}

// ── Client class ────────────────────────────────────────────────────────

export class CodexClient {
  private proc: Subprocess<'pipe', 'pipe', 'pipe'> | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, {
    method: string;
    resolve: (v: any) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private eventQueue: CodexEvent[] = [];
  private eventResolve: (() => void) | null = null;
  private turnDone = false;
  private readLoopDone = false;
  private closing = false;
  private stderrBuffer = '';

  threadId: string | null = null;
  private turnId: string | null = null;

  constructor(private options: CodexClientOptions) {}

  // ── Lifecycle ─────────────────────────────────────────────────────────

  async start(): Promise<void> {
    try {
      this.proc = Bun.spawn(['codex', 'app-server'], {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      });
    } catch (error) {
      throw this.buildStartupError(error);
    }
    this.startReadLoop();
    this.startStderrLoop();
  }

  async close(): Promise<void> {
    if (!this.proc) return;
    this.closing = true;
    try {
      this.proc.stdin.end();
    } catch { /* already closed */ }
    this.proc.kill();
    this.proc = null;
  }

  // ── Protocol: send / request ──────────────────────────────────────────

  private nextId(): number {
    return ++this.requestId;
  }

  private send(obj: unknown): void {
    if (!this.proc) throw new Error('CodexClient not started');
    const line = JSON.stringify(obj) + '\n';
    this.proc.stdin.write(line);
  }

  private sendRequest<T>(method: string, params: unknown): Promise<T> {
    const id = this.nextId();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.pendingRequests.get(id);
        if (!pending) return;
        this.pendingRequests.delete(id);
        reject(new Error(
          `Timed out waiting for Codex app-server response to ${method}. ` +
          'Run `codex doctor --summary` if this keeps happening.'
        ));
      }, 60_000);
      this.pendingRequests.set(id, { method, resolve, reject, timer });
      try {
        this.send({ jsonrpc: '2.0', id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private sendResponse(id: number, result: unknown): void {
    this.send({ jsonrpc: '2.0', id, result });
  }

  private sendNotification(method: string, params: unknown): void {
    this.send({ jsonrpc: '2.0', method, params });
  }

  // ── High-level API ────────────────────────────────────────────────────

  async initialize(): Promise<string> {
    const result = await this.sendRequest<{ userAgent: string }>('initialize', {
      clientInfo: { name: 'karl', title: 'Karl', version: '1.0' },
      capabilities: null,
    });
    this.sendNotification('initialized', {});
    return result.userAgent;
  }

  async startThread(): Promise<{ threadId: string; model: string }> {
    const result = await this.sendRequest<any>('thread/start', {
      cwd: this.options.cwd,
      approvalPolicy: this.options.approvalPolicy ?? 'never',
      sandbox: 'workspace-write',
      developerInstructions: this.options.instructions ?? null,
      model: this.options.model ?? null,
      ephemeral: this.options.ephemeral ?? false,
      experimentalRawEvents: false,
      persistExtendedHistory: false,
    });
    this.threadId = result.thread.id;
    return { threadId: result.thread.id, model: result.model };
  }

  async resumeThread(threadId: string): Promise<{ threadId: string; model: string }> {
    const result = await this.sendRequest<any>('thread/resume', {
      threadId,
      cwd: this.options.cwd,
      approvalPolicy: this.options.approvalPolicy ?? 'never',
      sandbox: 'workspace-write',
      experimentalRawEvents: false,
      persistExtendedHistory: false,
    });
    this.threadId = result.thread.id;
    return { threadId: result.thread.id, model: result.model };
  }

  async interrupt(): Promise<void> {
    if (!this.threadId || !this.turnId) return;
    try {
      await this.sendRequest('turn/interrupt', {
        threadId: this.threadId,
        turnId: this.turnId,
      });
    } catch { /* best-effort */ }
  }

  // ── Turn execution as async generator ─────────────────────────────────

  async *startTurn(input: string): AsyncGenerator<CodexEvent> {
    this.turnDone = false;
    this.eventQueue = [];
    this.eventResolve = null;

    // Fire off the turn request (response comes back via pendingRequests)
    const turnPromise = this.sendRequest<any>('turn/start', {
      threadId: this.threadId!,
      input: [{ type: 'text', text: input, text_elements: [] }],
      ...(this.options.effort ? { effort: this.options.effort } : {}),
      ...(this.options.outputSchema ? { outputSchema: this.options.outputSchema } : {}),
    });

    // Store turnId when the response arrives
    turnPromise.then(r => {
      this.turnId = r?.turn?.id ?? null;
    }).catch(() => {
      this.turnDone = true;
      this.eventResolve?.();
    });

    // Yield events as they arrive
    while (!this.turnDone) {
      while (this.eventQueue.length > 0) {
        yield this.eventQueue.shift()!;
      }
      if (!this.turnDone) {
        await new Promise<void>(r => { this.eventResolve = r; });
        this.eventResolve = null;
      }
    }

    // Drain remaining
    while (this.eventQueue.length > 0) {
      yield this.eventQueue.shift()!;
    }
  }

  // ── JSONL read loop ───────────────────────────────────────────────────

  private async startReadLoop(): Promise<void> {
    if (!this.proc) return;

    const proc = this.proc;
    const reader = this.proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            this.dispatch(JSON.parse(line));
          } catch { /* skip malformed */ }
        }
      }
    } finally {
      this.readLoopDone = true;
      const exitCode = await proc.exited.catch(() => null);
      if (!this.closing) {
        const error = this.buildProcessExitError(exitCode);
        this.rejectPendingRequests(error);

        // If the process dies mid-turn, signal completion.
        if (!this.turnDone) {
          this.pushEvent({ type: 'error', message: error.message, willRetry: false });
          this.pushEvent({ type: 'turn_completed', status: 'failed', lastMessage: null, error: error.message });
        }
      }
    }
  }

  private async startStderrLoop(): Promise<void> {
    if (!this.proc) return;

    const reader = this.proc.stderr.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        this.appendStderr(decoder.decode(value, { stream: true }));
      }
    } catch {
      // Best-effort diagnostic capture only.
    }
  }

  private appendStderr(chunk: string): void {
    this.stderrBuffer += chunk;
    if (this.stderrBuffer.length > 6000) {
      this.stderrBuffer = this.stderrBuffer.slice(-6000);
    }
  }

  private rejectPendingRequests(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  private buildStartupError(error: unknown): Error {
    const message = (error as Error)?.message ?? String(error);
    if (/not found|ENOENT|spawn/i.test(message)) {
      return new Error('Codex CLI was not found. Install Codex, then run `codex login` and try `karl magic` again.');
    }
    return new Error(`Failed to start Codex app-server: ${message}`);
  }

  private buildProcessExitError(exitCode: number | null): Error {
    const stderr = this.stderrBuffer.trim();
    const suffix = exitCode === null ? '' : ` (exit code ${exitCode})`;
    const lower = stderr.toLowerCase();

    if (lower.includes('not authenticated') ||
        lower.includes('not logged in') ||
        lower.includes('unauthorized') ||
        lower.includes('forbidden') ||
        lower.includes('login')) {
      return new Error(
        `Codex app-server exited before it was ready${suffix}. ` +
        'Run `codex login` first, or `codex login --device-auth` on a headless machine, then retry.'
      );
    }

    if (stderr) {
      return new Error(`Codex app-server exited before it was ready${suffix}:\n${stderr}`);
    }

    return new Error(
      `Codex app-server exited before it was ready${suffix}. ` +
      'Run `codex doctor --summary` to check the local Codex install and authentication.'
    );
  }

  // ── Message dispatch ──────────────────────────────────────────────────

  private dispatch(msg: any): void {
    // Response to our request (has id + result or error)
    if ('id' in msg && ('result' in msg || 'error' in msg)) {
      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        this.pendingRequests.delete(msg.id);
        clearTimeout(pending.timer);
        if ('error' in msg) {
          pending.reject(new Error(msg.error?.message ?? 'Unknown error'));
        } else {
          pending.resolve(msg.result);
        }
      }
      return;
    }

    // Server request (has id + method — needs response)
    if ('id' in msg && 'method' in msg) {
      this.handleServerRequest(msg.id, msg.method, msg.params);
      return;
    }

    // Notification (has method, no id)
    if ('method' in msg && !('id' in msg)) {
      this.handleNotification(msg.method, msg.params);
      return;
    }
  }

  // ── Server requests → auto-approve ────────────────────────────────────

  private handleServerRequest(id: number, method: string, _params: any): void {
    switch (method) {
      case 'item/commandExecution/requestApproval':
      case 'execCommandApproval':
        this.sendResponse(id, { decision: 'accept' });
        break;
      case 'item/fileChange/requestApproval':
      case 'applyPatchApproval':
        this.sendResponse(id, { decision: 'accept' });
        break;
      case 'item/tool/requestUserInput':
        this.sendResponse(id, { answers: {} });
        break;
      default:
        this.sendResponse(id, {});
    }
  }

  // ── Notifications → CodexEvent mapping ────────────────────────────────

  private handleNotification(method: string, params: any): void {
    // v2 notifications
    switch (method) {
      case 'item/agentMessage/delta':
        this.pushEvent({ type: 'agent_message_delta', text: params.delta });
        break;

      case 'item/reasoning/summaryTextDelta':
      case 'item/reasoning/textDelta':
        this.pushEvent({ type: 'reasoning_delta', text: params.delta });
        break;

      case 'item/commandExecution/outputDelta':
        this.pushEvent({ type: 'command_output_delta', delta: params.delta, itemId: params.itemId ?? '' });
        break;

      case 'item/fileChange/outputDelta':
        // Treat as file change info
        break;

      case 'item/plan/delta':
        this.pushEvent({ type: 'plan_delta', text: params.delta });
        break;

      case 'item/started': {
        const item = params.item;
        if (item?.type === 'commandExecution') {
          this.pushEvent({
            type: 'command_start',
            command: item.command ?? '',
            cwd: item.cwd ?? '',
            itemId: item.id ?? '',
          });
        } else if (item?.type === 'fileChange') {
          this.pushEvent({
            type: 'file_change',
            itemId: item.id ?? '',
            status: 'started',
            filePath: item.filePath ?? item.path ?? undefined,
          });
        }
        break;
      }

      case 'item/completed': {
        const item = params.item;
        if (item?.type === 'commandExecution') {
          this.pushEvent({
            type: 'command_end',
            command: item.command ?? '',
            exitCode: item.exitCode ?? null,
            durationMs: item.durationMs ?? null,
            itemId: item.id ?? '',
          });
        } else if (item?.type === 'fileChange') {
          this.pushEvent({
            type: 'file_change',
            itemId: item.id ?? '',
            status: item.status ?? 'unknown',
            filePath: item.filePath ?? item.path ?? undefined,
          });
        }
        break;
      }

      case 'turn/diff/updated':
        this.pushEvent({ type: 'turn_diff', diff: params.diff ?? '' });
        break;

      case 'thread/tokenUsage/updated': {
        const usage = params.tokenUsage?.total;
        if (usage) {
          this.pushEvent({
            type: 'token_usage',
            total: usage.totalTokens ?? 0,
            input: usage.inputTokens ?? 0,
            output: usage.outputTokens ?? 0,
            cached: usage.cachedInputTokens ?? 0,
            reasoning: usage.reasoningOutputTokens ?? 0,
          });
        }
        break;
      }

      case 'error':
        this.pushEvent({
          type: 'error',
          message: params.error?.message ?? 'Unknown error',
          willRetry: params.willRetry ?? false,
        });
        break;

      case 'turn/completed':
        this.pushEvent({
          type: 'turn_completed',
          status: params.turn?.status ?? 'completed',
          lastMessage: null,
          error: params.turn?.error?.message,
        });
        this.turnDone = true;
        break;

      default:
        // Ignore legacy codex/event/* notifications — v2 covers everything
        break;
    }
  }

  // ── Event queue helpers ───────────────────────────────────────────────

  private pushEvent(event: CodexEvent): void {
    this.eventQueue.push(event);
    this.eventResolve?.();
  }
}
