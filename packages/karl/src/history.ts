import path from 'path';
import { mkdirSync } from 'fs';
import { Database } from 'bun:sqlite';
import { resolveHomePath } from './utils.js';
import { type HistoryConfig, type TokenUsage, type ToolDiff } from './types.js';

const DEFAULT_HISTORY_PATH = '~/.config/karl/history/history.db';

export interface HistoryThinkingEntry {
  ts: number;
  text: string;
}

export type HistoryRunStatus = 'running' | 'success' | 'error';
export type HistoryTerminalReason =
  | 'succeeded'
  | 'failed'
  | 'timed_out'
  | 'stalled'
  | 'canceled'
  | 'process_lost';

export interface HistoryRunEventInput {
  type: string;
  createdAt?: number;
  attempt?: number;
  toolCallId?: string;
  toolName?: string;
  payload?: unknown;
  success?: boolean;
}

export interface HistoryRunEventRecord {
  runId: string;
  sequence: number;
  createdAt: number;
  type: string;
  attempt?: number;
  toolCallId?: string;
  toolName?: string;
  payload?: unknown;
  success?: boolean;
  truncated: boolean;
}

export interface HistoryRunStartInput extends Omit<HistoryRunInput, 'status' | 'completedAt' | 'durationMs' | 'exitCode' | 'response' | 'error' | 'thinking' | 'toolsUsed' | 'tokens' | 'diffs'> {
  ownerPid?: number;
}

export interface HistoryRunFinishInput {
  completedAt: number;
  durationMs: number;
  status: 'success' | 'error';
  terminalReason: HistoryTerminalReason;
  exitCode?: number;
  response?: string;
  error?: string;
  thinking?: HistoryThinkingEntry[];
  toolsUsed?: string[];
  tokens?: TokenUsage;
  diffs?: ToolDiff[];
}

export interface HistoryRunInput {
  id: string;
  createdAt: number;
  completedAt?: number;
  durationMs?: number;
  status: HistoryRunStatus;
  terminalReason?: HistoryTerminalReason;
  exitCode?: number;
  cwd: string;
  command: string;
  argv?: string[];
  stack?: string;
  modelKey?: string;
  modelId?: string;
  providerKey?: string;
  providerType?: string;
  skill?: string;
  prompt: string;
  response?: string;
  error?: string;
  thinking?: HistoryThinkingEntry[];
  contextFilePath?: string;
  contextFileRaw?: string;
  contextInline?: string;
  systemPrompt?: string;
  configSnapshot?: unknown;
  toolsUsed?: string[];
  tokens?: TokenUsage;
  diffs?: ToolDiff[];
  parentId?: string;
  tags?: string[];
}

export interface HistoryRunRecord {
  id: string;
  createdAt: number;
  completedAt?: number;
  durationMs?: number;
  status: HistoryRunStatus;
  terminalReason?: HistoryTerminalReason;
  exitCode?: number;
  cwd: string;
  command: string;
  argv?: string[];
  stack?: string;
  modelKey?: string;
  modelId?: string;
  providerKey?: string;
  providerType?: string;
  skill?: string;
  prompt: string;
  response?: string;
  error?: string;
  thinking?: HistoryThinkingEntry[];
  contextFilePath?: string;
  contextFileRaw?: string;
  contextInline?: string;
  systemPrompt?: string;
  configSnapshot?: unknown;
  toolsUsed?: string[];
  tokens?: TokenUsage;
  diffs?: ToolDiff[];
  parentId?: string;
  tags?: string[];
}

export interface HistoryRunSummary {
  id: string;
  createdAt: number;
  status: HistoryRunStatus;
  terminalReason?: HistoryTerminalReason;
  prompt: string;
  modelKey?: string;
  stack?: string;
  skill?: string;
  durationMs?: number;
}

export interface HistoryListOptions {
  limit?: number;
  since?: number;
  until?: number;
  tag?: string[];
  status?: HistoryRunStatus;
  stack?: string;
  model?: string;
  skill?: string;
}

function serializeJson(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }
  return JSON.stringify(value);
}

function parseJson<T>(value: string | null): T | undefined {
  if (!value) {
    return undefined;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

const SECRET_KEY = /api[_-]?key|authorization|token|password|secret|cookie/i;
const INLINE_SECRET = /(bearer\s+)[A-Za-z0-9._~+\/-]+|((?:api[_-]?key|token|password|secret)\s*[=:]\s*)[^\s"']+/gi;

export function serializeJournalPayload(
  value: unknown,
  limits: { maxStringBytes?: number; maxArrayItems?: number; maxDepth?: number } = {}
): { payload: unknown; truncated: boolean } {
  const maxStringBytes = limits.maxStringBytes ?? 4000;
  const maxArrayItems = limits.maxArrayItems ?? 50;
  const maxDepth = limits.maxDepth ?? 8;
  let truncated = false;

  const visit = (input: unknown, depth: number, key?: string): unknown => {
    if (key && SECRET_KEY.test(key)) return '[REDACTED]';
    if (key?.toLowerCase() === 'env') return '[REDACTED ENV]';
    if (depth > maxDepth) {
      truncated = true;
      return '[TRUNCATED DEPTH]';
    }
    if (typeof input === 'string') {
      const redacted = input.replace(INLINE_SECRET, (_match, bearerPrefix, assignmentPrefix) =>
        `${bearerPrefix ?? assignmentPrefix ?? ''}[REDACTED]`
      );
      const buffer = Buffer.from(redacted);
      if (buffer.byteLength <= maxStringBytes) return redacted;
      truncated = true;
      return Buffer.from(buffer.subarray(0, maxStringBytes)).toString('utf8') + '…';
    }
    if (Array.isArray(input)) {
      if (input.length > maxArrayItems) truncated = true;
      return input.slice(0, maxArrayItems).map((entry) => visit(entry, depth + 1));
    }
    if (input && typeof input === 'object') {
      const result: Record<string, unknown> = {};
      const entries = Object.entries(input);
      if (entries.length > maxArrayItems) truncated = true;
      for (const [entryKey, entryValue] of entries.slice(0, maxArrayItems)) {
        result[entryKey] = visit(entryValue, depth + 1, entryKey);
      }
      return result;
    }
    return input;
  };

  return { payload: visit(value, 0), truncated };
}

export function resolveHistoryPath(config: HistoryConfig | undefined, cwd: string): string {
  const rawPath = config?.path ?? DEFAULT_HISTORY_PATH;
  const resolved = resolveHomePath(rawPath);
  if (path.isAbsolute(resolved)) {
    return resolved;
  }
  return path.resolve(cwd, resolved);
}

export function buildHistoryId(now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, '');
  const rand = Math.random().toString(36).slice(2, 8);
  return `ace_${stamp}_${rand}`;
}

export function createHistoryStore(config: HistoryConfig | undefined, cwd: string): HistoryStore | null {
  if (config?.enabled === false) {
    return null;
  }
  const dbPath = resolveHistoryPath(config, cwd);
  return new HistoryStore(dbPath);
}

export class HistoryStore {
  private db: Database;

  constructor(private dbPath: string) {
    const dir = path.dirname(dbPath);
    mkdirSync(dir, { recursive: true });
    this.db = new Database(dbPath);
    this.init();
    this.reconcileInterruptedRuns();
  }

  private init(): void {
    this.db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  duration_ms INTEGER,
  status TEXT NOT NULL,
  exit_code INTEGER,
  cwd TEXT NOT NULL,
  command TEXT NOT NULL,
  argv TEXT,
  stack TEXT,
  model_key TEXT,
  model_id TEXT,
  provider_key TEXT,
  provider_type TEXT,
  skill TEXT,
  prompt TEXT NOT NULL,
  response TEXT,
  error TEXT,
  thinking TEXT,
  context_file_path TEXT,
  context_file_raw TEXT,
  context_inline TEXT,
  system_prompt TEXT,
  config_snapshot TEXT,
  tools_used TEXT,
  tokens TEXT,
  diffs TEXT,
  parent_id TEXT,
  FOREIGN KEY (parent_id) REFERENCES runs(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS run_tags (
  run_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, tag),
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_runs_created_at ON runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_parent_id ON runs(parent_id);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
CREATE INDEX IF NOT EXISTS idx_runs_stack ON runs(stack);
CREATE INDEX IF NOT EXISTS idx_runs_model_key ON runs(model_key);
CREATE INDEX IF NOT EXISTS idx_runs_provider_key ON runs(provider_key);
CREATE INDEX IF NOT EXISTS idx_run_tags_tag ON run_tags(tag);

CREATE TABLE IF NOT EXISTS run_events (
  run_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  type TEXT NOT NULL,
  attempt INTEGER,
  tool_call_id TEXT,
  tool_name TEXT,
  payload TEXT,
  success INTEGER,
  truncated INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (run_id, sequence),
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_run_events_created_at ON run_events(run_id, created_at);
`);
    this.ensureColumn('runs', 'terminal_reason', 'TEXT');
    this.ensureColumn('runs', 'owner_pid', 'INTEGER');
    this.db.exec('PRAGMA user_version = 2;');
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((entry) => entry.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  private writeTags(runId: string, createdAt: number, tags?: string[]): void {
    if (!tags || tags.length === 0) return;
    const statement = this.db.prepare(`
      INSERT OR IGNORE INTO run_tags (run_id, tag, created_at)
      VALUES ($run_id, $tag, $created_at)
    `);
    for (const tag of tags.map((value) => value.trim()).filter(Boolean)) {
      statement.run({ $run_id: runId, $tag: tag, $created_at: createdAt });
    }
  }

  startRun(run: HistoryRunStartInput): void {
    const statement = this.db.prepare(`
      INSERT INTO runs (
        id,
        created_at,
        completed_at,
        duration_ms,
        status,
        exit_code,
        cwd,
        command,
        argv,
        stack,
        model_key,
        model_id,
        provider_key,
        provider_type,
        skill,
        prompt,
        response,
        error,
        thinking,
        context_file_path,
        context_file_raw,
        context_inline,
        system_prompt,
        config_snapshot,
        tools_used,
        tokens,
        diffs,
        parent_id,
        terminal_reason,
        owner_pid
      ) VALUES (
        $id,
        $created_at,
        $completed_at,
        $duration_ms,
        $status,
        $exit_code,
        $cwd,
        $command,
        $argv,
        $stack,
        $model_key,
        $model_id,
        $provider_key,
        $provider_type,
        $skill,
        $prompt,
        $response,
        $error,
        $thinking,
        $context_file_path,
        $context_file_raw,
        $context_inline,
        $system_prompt,
        $config_snapshot,
        $tools_used,
        $tokens,
        $diffs,
        $parent_id,
        $terminal_reason,
        $owner_pid
      )
    `);

    this.db.transaction(() => {
      statement.run({
        $id: run.id,
        $created_at: run.createdAt,
        $completed_at: null,
        $duration_ms: null,
        $status: 'running',
        $exit_code: null,
        $cwd: run.cwd,
        $command: run.command,
        $argv: serializeJson(run.argv),
        $stack: run.stack ?? null,
        $model_key: run.modelKey ?? null,
        $model_id: run.modelId ?? null,
        $provider_key: run.providerKey ?? null,
        $provider_type: run.providerType ?? null,
        $skill: run.skill ?? null,
        $prompt: run.prompt,
        $response: null,
        $error: null,
        $thinking: null,
        $context_file_path: run.contextFilePath ?? null,
        $context_file_raw: run.contextFileRaw ?? null,
        $context_inline: run.contextInline ?? null,
        $system_prompt: run.systemPrompt ?? null,
        $config_snapshot: serializeJson(run.configSnapshot),
        $tools_used: null,
        $tokens: null,
        $diffs: null,
        $parent_id: run.parentId ?? null,
        $terminal_reason: null,
        $owner_pid: run.ownerPid ?? process.pid
      });
      this.writeTags(run.id, run.createdAt, run.tags);
      this.appendRunEventRow(run.id, { type: 'run_started', createdAt: run.createdAt });
    })();
  }

  finishRun(runId: string, finish: HistoryRunFinishInput): void {
    const statement = this.db.prepare(`
      UPDATE runs SET
        completed_at = $completed_at,
        duration_ms = $duration_ms,
        status = $status,
        exit_code = $exit_code,
        response = $response,
        error = $error,
        thinking = $thinking,
        tools_used = $tools_used,
        tokens = $tokens,
        diffs = $diffs,
        terminal_reason = $terminal_reason
      WHERE id = $id
    `);
    this.db.transaction(() => {
      statement.run({
        $id: runId,
        $completed_at: finish.completedAt,
        $duration_ms: finish.durationMs,
        $status: finish.status,
        $exit_code: finish.exitCode ?? null,
        $response: finish.response ?? null,
        $error: finish.error ?? null,
        $thinking: serializeJson(finish.thinking),
        $tools_used: serializeJson(finish.toolsUsed),
        $tokens: serializeJson(finish.tokens),
        $diffs: serializeJson(finish.diffs),
        $terminal_reason: finish.terminalReason
      });
      this.appendRunEventRow(runId, {
        type: 'run_finished',
        createdAt: finish.completedAt,
        success: finish.status === 'success',
        payload: { terminalReason: finish.terminalReason, error: finish.error }
      });
    })();
  }

  insertRun(run: HistoryRunInput): void {
    this.startRun({
      id: run.id,
      createdAt: run.createdAt,
      cwd: run.cwd,
      command: run.command,
      argv: run.argv,
      stack: run.stack,
      modelKey: run.modelKey,
      modelId: run.modelId,
      providerKey: run.providerKey,
      providerType: run.providerType,
      skill: run.skill,
      prompt: run.prompt,
      contextFilePath: run.contextFilePath,
      contextFileRaw: run.contextFileRaw,
      contextInline: run.contextInline,
      systemPrompt: run.systemPrompt,
      configSnapshot: run.configSnapshot,
      parentId: run.parentId,
      tags: run.tags
    });
    this.finishRun(run.id, {
      completedAt: run.completedAt ?? run.createdAt,
      durationMs: run.durationMs ?? 0,
      status: run.status === 'running' ? 'error' : run.status,
      terminalReason: run.terminalReason ?? (run.status === 'success' ? 'succeeded' : 'failed'),
      exitCode: run.exitCode,
      response: run.response,
      error: run.error,
      thinking: run.thinking,
      toolsUsed: run.toolsUsed,
      tokens: run.tokens,
      diffs: run.diffs
    });
  }

  appendRunEvent(runId: string, event: HistoryRunEventInput): number {
    return this.db.transaction(() => this.appendRunEventRow(runId, event))();
  }

  private appendRunEventRow(runId: string, event: HistoryRunEventInput): number {
    const serialized = serializeJournalPayload(event.payload);
    const row = this.db.query('SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM run_events WHERE run_id = ?').get(runId) as { sequence: number };
    const sequence = Number(row.sequence);
    this.db.prepare(`
      INSERT INTO run_events (
        run_id, sequence, created_at, type, attempt, tool_call_id, tool_name, payload, success, truncated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      runId,
      sequence,
      event.createdAt ?? Date.now(),
      event.type,
      event.attempt ?? null,
      event.toolCallId ?? null,
      event.toolName ?? null,
      serializeJson(serialized.payload),
      event.success === undefined ? null : event.success ? 1 : 0,
      serialized.truncated ? 1 : 0
    );
    return sequence;
  }

  getRunEvents(ref: string): HistoryRunEventRecord[] {
    const runId = this.resolveRunId(ref);
    if (!runId) return [];
    const rows = this.db.query('SELECT * FROM run_events WHERE run_id = ? ORDER BY sequence').all(runId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      runId: String(row.run_id),
      sequence: Number(row.sequence),
      createdAt: Number(row.created_at),
      type: String(row.type),
      attempt: row.attempt === null ? undefined : Number(row.attempt),
      toolCallId: row.tool_call_id ? String(row.tool_call_id) : undefined,
      toolName: row.tool_name ? String(row.tool_name) : undefined,
      payload: parseJson<unknown>(row.payload as string | null),
      success: row.success === null ? undefined : Number(row.success) === 1,
      truncated: Number(row.truncated) === 1
    }));
  }

  reconcileInterruptedRuns(): number {
    const rows = this.db.query("SELECT id, created_at, owner_pid FROM runs WHERE status = 'running'").all() as Array<{ id: string; created_at: number; owner_pid: number | null }>;
    let reconciled = 0;
    for (const row of rows) {
      if (row.owner_pid && row.owner_pid !== process.pid && this.processExists(row.owner_pid)) continue;
      if (row.owner_pid === process.pid) continue;
      const completedAt = Date.now();
      this.finishRun(row.id, {
        completedAt,
        durationMs: Math.max(0, completedAt - row.created_at),
        status: 'error',
        terminalReason: 'process_lost',
        exitCode: 1,
        error: 'Previous Karl process ended before recording a terminal event.'
      });
      reconciled++;
    }
    return reconciled;
  }

  private processExists(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
  }

  close(): void {
    this.db.close();
  }

  listRuns(options: HistoryListOptions = {}): HistoryRunSummary[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    let sql = `
      SELECT r.id, r.created_at, r.status, r.terminal_reason, r.prompt, r.model_key, r.stack, r.skill, r.duration_ms
      FROM runs r
    `;

    if (options.tag && options.tag.length > 0) {
      sql += ' JOIN run_tags t ON t.run_id = r.id';
      const placeholders = options.tag.map(() => '?').join(', ');
      where.push(`t.tag IN (${placeholders})`);
      params.push(...options.tag);
    }

    if (options.since !== undefined) {
      where.push('r.created_at >= ?');
      params.push(options.since);
    }
    if (options.until !== undefined) {
      where.push('r.created_at <= ?');
      params.push(options.until);
    }
    if (options.status) {
      where.push('r.status = ?');
      params.push(options.status);
    }
    if (options.stack) {
      where.push('r.stack = ?');
      params.push(options.stack);
    }
    if (options.model) {
      where.push('(r.model_key = ? OR r.model_id = ?)');
      params.push(options.model, options.model);
    }
    if (options.skill) {
      where.push('r.skill = ?');
      params.push(options.skill);
    }

    if (where.length > 0) {
      sql += ' WHERE ' + where.join(' AND ');
    }

    if (options.tag && options.tag.length > 0) {
      sql += ' GROUP BY r.id';
    }

    sql += ' ORDER BY r.created_at DESC';

    const limit = options.limit && options.limit > 0 ? options.limit : 20;
    sql += ' LIMIT ?';
    params.push(limit);

    const rows = this.db.query(sql).all(...params) as Array<{
      id: string;
      created_at: number;
      status: HistoryRunStatus;
      terminal_reason: HistoryTerminalReason | null;
      prompt: string;
      model_key: string | null;
      stack: string | null;
      skill: string | null;
      duration_ms: number | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      status: row.status,
      terminalReason: row.terminal_reason ?? undefined,
      prompt: row.prompt,
      modelKey: row.model_key ?? undefined,
      stack: row.stack ?? undefined,
      skill: row.skill ?? undefined,
      durationMs: row.duration_ms ?? undefined
    }));
  }

  getLatestRun(): HistoryRunRecord | null {
    const row = this.db.query('SELECT * FROM runs ORDER BY created_at DESC LIMIT 1').get() as Record<string, unknown> | null;
    return row ? this.mapRow(row) : null;
  }

  resolveRunId(ref: string): string | null {
    if (!ref) {
      return null;
    }

    if (ref.startsWith('@')) {
      const token = ref.slice(1);
      if (token === 'last') {
        const row = this.db.query('SELECT id FROM runs ORDER BY created_at DESC LIMIT 1').get() as { id: string } | null;
        return row?.id ?? null;
      }
      const offsetMatch = token.match(/^-([0-9]+)$/);
      if (offsetMatch) {
        const offset = Number(offsetMatch[1]);
        const row = this.db.query('SELECT id FROM runs ORDER BY created_at DESC LIMIT 1 OFFSET ?').get(offset) as { id: string } | null;
        return row?.id ?? null;
      }
      ref = token;
    }

    const prefix = ref;
    const rows = this.db
      .query('SELECT id FROM runs WHERE id LIKE ? ORDER BY created_at DESC LIMIT 2')
      .all(`${prefix}%`) as Array<{ id: string }>;
    if (rows.length === 1) {
      return rows[0].id;
    }
    if (rows.length > 1) {
      throw new Error(`History id prefix "${prefix}" is ambiguous.`);
    }
    return null;
  }

  getRunById(ref: string): HistoryRunRecord | null {
    const id = this.resolveRunId(ref);
    if (!id) {
      return null;
    }
    const row = this.db.query('SELECT * FROM runs WHERE id = ?').get(id) as Record<string, unknown> | null;
    return row ? this.mapRow(row) : null;
  }

  getTagsForRun(runId: string): string[] {
    const rows = this.db.query('SELECT tag FROM run_tags WHERE run_id = ? ORDER BY tag').all(runId) as Array<{ tag: string }>;
    return rows.map((row) => row.tag);
  }

  private mapRow(row: Record<string, unknown>): HistoryRunRecord {
    const tags = row.id ? this.getTagsForRun(String(row.id)) : [];
    return {
      id: String(row.id),
      createdAt: Number(row.created_at),
      completedAt: row.completed_at ? Number(row.completed_at) : undefined,
      durationMs: row.duration_ms ? Number(row.duration_ms) : undefined,
      status: row.status as HistoryRunStatus,
      terminalReason: row.terminal_reason ? String(row.terminal_reason) as HistoryTerminalReason : undefined,
      exitCode: row.exit_code === null || row.exit_code === undefined ? undefined : Number(row.exit_code),
      cwd: String(row.cwd),
      command: String(row.command),
      argv: parseJson<string[]>(row.argv as string | null),
      stack: row.stack ? String(row.stack) : undefined,
      modelKey: row.model_key ? String(row.model_key) : undefined,
      modelId: row.model_id ? String(row.model_id) : undefined,
      providerKey: row.provider_key ? String(row.provider_key) : undefined,
      providerType: row.provider_type ? String(row.provider_type) : undefined,
      skill: row.skill ? String(row.skill) : undefined,
      prompt: String(row.prompt),
      response: row.response ? String(row.response) : undefined,
      error: row.error ? String(row.error) : undefined,
      thinking: parseJson<HistoryThinkingEntry[]>(row.thinking as string | null),
      contextFilePath: row.context_file_path ? String(row.context_file_path) : undefined,
      contextFileRaw: row.context_file_raw ? String(row.context_file_raw) : undefined,
      contextInline: row.context_inline ? String(row.context_inline) : undefined,
      systemPrompt: row.system_prompt ? String(row.system_prompt) : undefined,
      configSnapshot: parseJson<unknown>(row.config_snapshot as string | null),
      toolsUsed: parseJson<string[]>(row.tools_used as string | null),
      tokens: parseJson<TokenUsage>(row.tokens as string | null),
      diffs: parseJson<ToolDiff[]>(row.diffs as string | null),
      parentId: row.parent_id ? String(row.parent_id) : undefined,
      tags
    };
  }
}
