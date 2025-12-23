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

export interface HistoryRunInput {
  id: string;
  createdAt: number;
  completedAt?: number;
  durationMs?: number;
  status: 'success' | 'error';
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
  status: 'success' | 'error';
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
  status: 'success' | 'error';
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
  status?: 'success' | 'error';
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
  }

  private init(): void {
    this.db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA user_version = 1;

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
`);
  }

  insertRun(run: HistoryRunInput): void {
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
        parent_id
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
        $parent_id
      )
    `);

    statement.run({
      $id: run.id,
      $created_at: run.createdAt,
      $completed_at: run.completedAt ?? null,
      $duration_ms: run.durationMs ?? null,
      $status: run.status,
      $exit_code: run.exitCode ?? null,
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
      $response: run.response ?? null,
      $error: run.error ?? null,
      $thinking: serializeJson(run.thinking),
      $context_file_path: run.contextFilePath ?? null,
      $context_file_raw: run.contextFileRaw ?? null,
      $context_inline: run.contextInline ?? null,
      $system_prompt: run.systemPrompt ?? null,
      $config_snapshot: serializeJson(run.configSnapshot),
      $tools_used: serializeJson(run.toolsUsed),
      $tokens: serializeJson(run.tokens),
      $diffs: serializeJson(run.diffs),
      $parent_id: run.parentId ?? null
    });

    if (run.tags && run.tags.length > 0) {
      const tagStatement = this.db.prepare(`
        INSERT OR IGNORE INTO run_tags (run_id, tag, created_at)
        VALUES ($run_id, $tag, $created_at)
      `);
      for (const tag of run.tags.map((t) => t.trim()).filter(Boolean)) {
        tagStatement.run({
          $run_id: run.id,
          $tag: tag,
          $created_at: run.createdAt
        });
      }
    }
  }

  listRuns(options: HistoryListOptions = {}): HistoryRunSummary[] {
    const where: string[] = [];
    const params: unknown[] = [];
    let sql = `
      SELECT r.id, r.created_at, r.status, r.prompt, r.model_key, r.stack, r.skill, r.duration_ms
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

    const rows = this.db.query(sql).all(params) as Array<{
      id: string;
      created_at: number;
      status: 'success' | 'error';
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
      status: row.status as 'success' | 'error',
      exitCode: row.exit_code ? Number(row.exit_code) : undefined,
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
