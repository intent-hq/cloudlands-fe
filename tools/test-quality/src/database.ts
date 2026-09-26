import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type {
  Analysis,
  Judgment,
  ResultRow,
  RunRow,
  Target,
  Trace,
  EvidenceCompleteness,
} from './types.ts';

export class Store {
  db: DatabaseSync;
  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    const version = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (version.user_version > 2) throw new Error('Database schema is newer than this evaluator');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS analysis_cache (key TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS traces (id TEXT PRIMARY KEY, file TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, started TEXT NOT NULL, finished TEXT, status TEXT NOT NULL, options TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS evaluations (
        id INTEGER PRIMARY KEY, cache_key TEXT NOT NULL, trace_id TEXT NOT NULL REFERENCES traces(id),
        created TEXT NOT NULL, requested_model TEXT NOT NULL, model TEXT NOT NULL, rubric TEXT NOT NULL,
        request TEXT NOT NULL, response TEXT NOT NULL, elapsed_ms REAL NOT NULL
      );
      CREATE INDEX IF NOT EXISTS evaluation_cache ON evaluations(cache_key, id DESC);
      CREATE TABLE IF NOT EXISTS results (
        run_id TEXT NOT NULL REFERENCES runs(id), target_id TEXT NOT NULL, kind TEXT NOT NULL, file TEXT NOT NULL,
        parent_id TEXT, target TEXT NOT NULL, trace_id TEXT NOT NULL REFERENCES traces(id),
        evaluation_id INTEGER REFERENCES evaluations(id), score REAL, confidence REAL,
        details TEXT, warnings TEXT NOT NULL, error TEXT, cached INTEGER NOT NULL,
        PRIMARY KEY(run_id, target_id)
      );
      CREATE INDEX IF NOT EXISTS result_scores ON results(run_id, kind, score);
      CREATE INDEX IF NOT EXISTS result_history ON results(target_id, run_id);

    `);
    if (
      !(this.db.prepare('PRAGMA table_info(results)').all() as { name: string }[]).some(
        (c) => c.name === 'decision',
      )
    )
      this.db.exec('ALTER TABLE results ADD COLUMN decision TEXT');
    if (
      !(this.db.prepare('PRAGMA table_info(results)').all() as { name: string }[]).some(
        (c) => c.name === 'evidence',
      )
    )
      this.db.exec('ALTER TABLE results ADD COLUMN evidence TEXT');
    this.db.exec('PRAGMA user_version=2');
  }
  close(): void {
    this.db.close();
  }
  cachedAnalysis(key: string): Analysis | undefined {
    const row = this.db.prepare('SELECT data FROM analysis_cache WHERE key=?').get(key) as
      { data: string } | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }
  saveAnalysis(key: string, analysis: Analysis): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const insert = this.db.prepare('INSERT OR IGNORE INTO traces VALUES (?,?,?)');
      for (const trace of analysis.traces) insert.run(trace.id, trace.file, JSON.stringify(trace));
      this.db
        .prepare('INSERT OR REPLACE INTO analysis_cache VALUES (?,?)')
        .run(key, JSON.stringify(analysis));
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  trace(id: string): Trace {
    const row = this.db.prepare('SELECT data FROM traces WHERE id=?').get(id) as
      { data: string } | undefined;
    if (!row) throw new Error(`Trace not found: ${id}`);
    return JSON.parse(row.data);
  }
  start(options: unknown): string {
    const id = randomUUID();
    this.db
      .prepare('INSERT INTO runs VALUES (?,?,NULL,?,?)')
      .run(id, new Date().toISOString(), 'running', JSON.stringify(options));
    return id;
  }
  finish(id: string, status: string): void {
    this.db
      .prepare('UPDATE runs SET finished=?, status=? WHERE id=? AND finished IS NULL')
      .run(new Date().toISOString(), status, id);
  }
  run(id?: string): RunRow {
    const row = (id
      ? this.db.prepare('SELECT * FROM runs WHERE id=?').get(id)
      : this.db.prepare('SELECT * FROM runs ORDER BY rowid DESC LIMIT 1').get()) as unknown as
      RunRow | undefined;
    if (!row) throw new Error('No matching evaluation run. Run evaluate first.');
    return row;
  }
  cachedEvaluation(key: string): { id: number; judgment: Judgment } | undefined {
    const row = this.db
      .prepare('SELECT id,response FROM evaluations WHERE cache_key=? ORDER BY id DESC LIMIT 1')
      .get(key) as { id: number; response: string } | undefined;
    return row ? { id: row.id, judgment: JSON.parse(row.response) } : undefined;
  }
  saveEvaluation(
    key: string,
    traceId: string,
    requestedModel: string,
    rubric: string,
    request: unknown,
    judgment: Judgment,
    elapsedMs: number,
  ): number {
    const row = this.db
      .prepare(
        'INSERT INTO evaluations (cache_key,trace_id,created,requested_model,model,rubric,request,response,elapsed_ms) VALUES (?,?,?,?,?,?,?,?,?)',
      )
      .run(
        key,
        traceId,
        new Date().toISOString(),
        requestedModel,
        judgment.model,
        rubric,
        JSON.stringify(request),
        JSON.stringify(judgment),
        elapsedMs,
      );
    return Number(row.lastInsertRowid);
  }
  result(
    run: string,
    target: Target,
    traceId: string,
    evaluationId: number | null,
    judgment: Judgment | null,
    warnings: string[],
    error: string | null,
    cached: boolean,
    context?: EvidenceCompleteness,
  ): void {
    if (this.run(run).finished !== null) throw new Error('Cannot add results to a finished run');
    const score = judgment?.scores[target.id] ?? null;
    const evidence = judgment?.reviews?.[target.id]?.evidence ?? context ?? null;
    this.db
      .prepare('INSERT INTO results VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(
        run,
        target.id,
        target.kind,
        target.file,
        target.parentId ?? null,
        JSON.stringify(target),
        traceId,
        evaluationId,
        score?.overall ?? null,
        score?.confidence ?? null,
        score ? JSON.stringify(score) : null,
        JSON.stringify(warnings),
        error,
        Number(cached),
        judgment?.reviews?.[target.id] ? JSON.stringify(judgment.reviews[target.id]) : null,
        evidence ? JSON.stringify(evidence) : null,
      );
  }
  results(runId: string): ResultRow[] {
    const rows = this.db
      .prepare(
        `SELECT r.*, e.model FROM results r LEFT JOIN evaluations e ON e.id=r.evaluation_id WHERE r.run_id=? ORDER BY r.file, r.target_id`,
      )
      .all(runId) as Record<string, unknown>[];
    return rows.map((r) => ({
      target: JSON.parse(String(r.target)),
      traceId: String(r.trace_id),
      evaluationId: r.evaluation_id === null ? null : Number(r.evaluation_id),
      score: r.details === null ? null : JSON.parse(String(r.details)),
      model: r.model === null ? null : String(r.model),
      warnings: JSON.parse(String(r.warnings)),
      error: r.error === null ? null : String(r.error),
      cached: r.cached === 1,
      decision: r.decision == null ? null : JSON.parse(String(r.decision)),
      evidence: r.evidence == null ? null : JSON.parse(String(r.evidence)),
    }));
  }
  evaluation(id: number): unknown {
    const row = this.db.prepare('SELECT * FROM evaluations WHERE id=?').get(id) as
      Record<string, unknown> | undefined;
    if (!row) throw new Error(`Evaluation not found: ${id}`);
    return {
      ...row,
      request: JSON.parse(String(row.request)),
      response: JSON.parse(String(row.response)),
    };
  }
  history(targetId: string): unknown[] {
    return this.db
      .prepare(
        'SELECT run_id, evaluation_id, score, confidence, error FROM results WHERE target_id=? ORDER BY rowid DESC',
      )
      .all(targetId);
  }
}
