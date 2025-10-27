import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

interface RedirectRow {
  job_id: string;
  url: string;
  expires_at: number;
  created_at: number;
}

interface RedirectCacheEntry {
  jobId: string;
  url: string;
  expiresAtMs: number;
  createdAtMs: number;
}

export interface RedirectEntry {
  jobId: string;
  url: string;
  expiresAt: string;
  createdAt: string;
}

export interface RedirectRegistration {
  jobId: string;
  url: string;
  expiresAt: Date;
}

export interface RedirectRecord {
  jobId: string;
  url: string;
  expiresAtMs: number;
  createdAtMs: number;
}

export class RedirectRegistry {
  private db?: Database.Database;
  private readonly cache = new Map<string, RedirectCacheEntry>();
  private started = false;

  private selectAllStmt?: Database.Statement;
  private selectOneStmt?: Database.Statement;
  private insertStmt?: Database.Statement;
  private deleteOneStmt?: Database.Statement;

  constructor(private readonly dbPath: string) {}

  start(): void {
    if (this.started) {
      return;
    }

    this.ensureDirectory();
    this.db = new Database(this.dbPath);
    this.started = true;
    this.applyPragmas();
    this.prepareSchema();
    this.prepareStatements();
    this.loadCache();
  }

  close(): void {
    if (!this.started) {
      return;
    }

    this.cache.clear();
    this.selectAllStmt = undefined;
    this.selectOneStmt = undefined;
    this.deleteOneStmt = undefined;
    this.insertStmt = undefined;

    this.db?.close();
    this.db = undefined;
    this.started = false;
  }

  register(registration: RedirectRegistration): void {
    this.ensureStarted();
    const insertStmt = this.insertStmt!;
    const selectOneStmt = this.selectOneStmt!;

    const expiresAtMs = registration.expiresAt.getTime();
    const now = Date.now();

    insertStmt.run({
      jobId: registration.jobId,
      url: registration.url,
      expiresAt: expiresAtMs,
      createdAt: now
    });

    const row = selectOneStmt.get(registration.jobId) as RedirectRow | undefined;
    if (row) {
      const entry = this.rowToCacheEntry(row);
      this.cache.set(entry.jobId, entry);
    }
  }

  resolve(jobId: string): string | undefined {
    const record = this.getRecord(jobId);
    if (!record) {
      return undefined;
    }
    if (record.expiresAtMs <= Date.now()) {
      return undefined;
    }
    return record.url;
  }

  remove(jobId: string): boolean {
    this.ensureStarted();
    const deleteOneStmt = this.deleteOneStmt!;
    deleteOneStmt.run(jobId);
    return this.cache.delete(jobId);
  }

  listActive(): RedirectEntry[] {
    this.ensureStarted();
    return [...this.cache.values()]
      .sort((a, b) => a.expiresAtMs - b.expiresAtMs)
      .map((entry) => ({
        jobId: entry.jobId,
        url: entry.url,
        expiresAt: new Date(entry.expiresAtMs).toISOString(),
        createdAt: new Date(entry.createdAtMs).toISOString()
      }));
  }

  private rowToCacheEntry(row: RedirectRow): RedirectCacheEntry {
    return {
      jobId: row.job_id,
      url: row.url,
      expiresAtMs: row.expires_at,
      createdAtMs: row.created_at
    };
  }

  getRecord(jobId: string): RedirectRecord | undefined {
    this.ensureStarted();
    const entry = this.cache.get(jobId);
    if (!entry) {
      return undefined;
    }
    return {
      jobId: entry.jobId,
      url: entry.url,
      expiresAtMs: entry.expiresAtMs,
      createdAtMs: entry.createdAtMs
    };
  }

  private ensureDirectory(): void {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private loadCache(): void {
    this.ensureStarted();
    const rows = this.selectAllStmt!.all() as RedirectRow[];
    for (const row of rows) {
      this.cache.set(row.job_id, this.rowToCacheEntry(row));
    }
  }

  private applyPragmas(): void {
    const db = this.db!;
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
  }

  private prepareSchema(): void {
    const db = this.db!;
    db.exec(`
      CREATE TABLE IF NOT EXISTS redirects (
        job_id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_redirects_expires_at ON redirects (expires_at);
    `);
  }

  private prepareStatements(): void {
    const db = this.db!;
    this.selectAllStmt = db.prepare('SELECT job_id, url, expires_at, created_at FROM redirects');
    this.selectOneStmt = db.prepare('SELECT job_id, url, expires_at, created_at FROM redirects WHERE job_id = ?');
    this.insertStmt = db.prepare(`
      INSERT INTO redirects (job_id, url, expires_at, created_at)
      VALUES (@jobId, @url, @expiresAt, @createdAt)
      ON CONFLICT(job_id) DO UPDATE SET
        url = excluded.url,
        expires_at = excluded.expires_at
    `);
    this.deleteOneStmt = db.prepare('DELETE FROM redirects WHERE job_id = ?');
  }

  private ensureStarted(): void {
    if (!this.started || !this.db) {
      throw new Error('RedirectRegistry must be started before use');
    }
  }
}
