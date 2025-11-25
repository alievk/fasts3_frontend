import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { ChatNotificationTarget, ChatRecord, ChatRegistry, OwnedJob, StoredJob } from './types.js';

type UserRow = {
  telegram_id: string;
  created_at: string;
  updated_at: string;
  locale: string | null;
};

type JobRow = {
  job_id: string;
  telegram_id: string;
  payload: string;
  created_at: string;
  updated_at: string;
};

const ensureDirectory = (filePath: string): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
};

const serializeJob = (job: OwnedJob): string => JSON.stringify(job);
const deserializeJob = (payload: string): OwnedJob => JSON.parse(payload) as OwnedJob;

const toChatRecord = (row: UserRow): ChatRecord => ({
  telegramId: row.telegram_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  locale: row.locale ?? null
});

export class SQLiteChatRegistry implements ChatRegistry {
  private db: Database.Database;

  private upsertUserStmt: Database.Statement;
  private getUserStmt: Database.Statement;
  private listJobsStmt: Database.Statement;
  private listAllJobsStmt: Database.Statement;
  private getJobStmt: Database.Statement;
  private upsertJobStmt: Database.Statement;
  private deleteJobStmt: Database.Statement;
  private notificationTargetsStmt: Database.Statement;
  private getChatLocaleStmt: Database.Statement;
  private setChatLocaleStmt: Database.Statement;

  constructor(private readonly dbPath: string) {
    ensureDirectory(dbPath);
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initSchema();
    this.upsertUserStmt = this.db.prepare(
      `
      INSERT INTO users (telegram_id, locale, created_at, updated_at)
      VALUES (@telegramId, @locale, @createdAt, @updatedAt)
      ON CONFLICT(telegram_id) DO UPDATE SET
        updated_at = excluded.updated_at
    `.trim()
    );
    this.getUserStmt = this.db.prepare('SELECT * FROM users WHERE telegram_id = ?');
    this.listJobsStmt = this.db.prepare('SELECT * FROM jobs WHERE telegram_id = ? ORDER BY created_at DESC');
    this.listAllJobsStmt = this.db.prepare('SELECT * FROM jobs ORDER BY created_at DESC');
    this.getJobStmt = this.db.prepare('SELECT * FROM jobs WHERE job_id = ?');
    this.upsertJobStmt = this.db.prepare(
      `
      INSERT INTO jobs (job_id, telegram_id, payload, created_at, updated_at)
      VALUES (@jobId, @telegramId, @payload, @createdAt, @updatedAt)
      ON CONFLICT(job_id) DO UPDATE SET
        telegram_id = excluded.telegram_id,
        payload = excluded.payload,
        updated_at = excluded.updated_at
    `.trim()
    );
    this.deleteJobStmt = this.db.prepare('DELETE FROM jobs WHERE job_id = ?');
    this.notificationTargetsStmt = this.db.prepare(
      `
      SELECT u.*
      FROM jobs j
      JOIN users u ON u.telegram_id = j.telegram_id
      WHERE j.job_id = ?
    `.trim()
    );
    this.getChatLocaleStmt = this.db.prepare('SELECT locale FROM users WHERE telegram_id = ?');
    this.setChatLocaleStmt = this.db.prepare(
      `
      UPDATE users
      SET locale = @locale,
          updated_at = @updatedAt
      WHERE telegram_id = @telegramId
    `.trim()
    );
  }

  async registerChat(telegramId: string): Promise<ChatRecord> {
    const timestamp = new Date().toISOString();
    this.upsertUserStmt.run({
      telegramId,
      locale: null,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    const row = this.getUserStmt.get(telegramId) as UserRow | undefined;
    if (!row) {
      throw new Error(`Failed to load user ${telegramId} after upsert`);
    }
    return toChatRecord(row);
  }

  async listJobs(telegramId: string): Promise<OwnedJob[]> {
    const rows = this.listJobsStmt.all(telegramId) as JobRow[];
    return rows.map((row) => deserializeJob(row.payload));
  }

  async listAllJobs(): Promise<OwnedJob[]> {
    const rows = this.listAllJobsStmt.all() as JobRow[];
    return rows.map((row) => deserializeJob(row.payload));
  }

  async getJob(jobId: string): Promise<OwnedJob | undefined> {
    const row = this.getJobStmt.get(jobId) as JobRow | undefined;
    return row ? deserializeJob(row.payload) : undefined;
  }

  async bindJobToChat(job: StoredJob, telegramId: string): Promise<OwnedJob> {
    const owned: OwnedJob = { ...job, telegramId };
    await this.saveJob(owned);
    return owned;
  }

  async updateJob(job: OwnedJob): Promise<void> {
    await this.saveJob(job);
  }

  async deleteJob(jobId: string): Promise<void> {
    this.deleteJobStmt.run(jobId);
  }

  async getNotificationTargets(jobId: string): Promise<ChatNotificationTarget[]> {
    const rows = this.notificationTargetsStmt.all(jobId) as UserRow[];
    return rows.map((row) => ({
      telegramId: row.telegram_id,
      locale: row.locale ?? null
    }));
  }

  async getChatLocale(telegramId: string): Promise<string | null> {
    const row = this.getChatLocaleStmt.get(telegramId) as { locale: string | null } | undefined;
    return row?.locale ?? null;
  }

  async setChatLocale(telegramId: string, locale: string | null): Promise<void> {
    const timestamp = new Date().toISOString();
    this.setChatLocaleStmt.run({
      telegramId,
      locale,
      updatedAt: timestamp
    });
  }

  private initSchema(): void {
    this.db.exec(
      `
      CREATE TABLE IF NOT EXISTS users (
        telegram_id TEXT PRIMARY KEY,
        locale TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS jobs (
        job_id TEXT PRIMARY KEY,
        telegram_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (telegram_id) REFERENCES users(telegram_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS jobs_telegram_id_idx ON jobs(telegram_id);
    `.trim()
    );
  }

  private async saveJob(job: OwnedJob): Promise<void> {
    const timestamp = new Date().toISOString();
    this.upsertJobStmt.run({
      jobId: job.jobId,
      telegramId: job.telegramId,
      payload: serializeJob(job),
      createdAt: timestamp,
      updatedAt: timestamp
    });
  }
}
