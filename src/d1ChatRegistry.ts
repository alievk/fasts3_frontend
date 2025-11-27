import { ChatNotificationTarget, ChatRecord, ChatRegistry, OwnedJob, StoredJob } from './types.js';
import { D1BaseClient } from './d1BaseClient.js';

type UserRow = {
  telegram_id: string;
  created_at: string;
  updated_at: string;
  locale: string | null;
  subscription_expires_at?: string | null;
  demo_used?: number | null;
};

type JobRow = {
  job_id: string;
  telegram_id: string;
  payload: string;
  created_at: string;
  updated_at: string;
};

const serializeJob = (job: OwnedJob): string => JSON.stringify(job);
const deserializeJob = (payload: string): OwnedJob => JSON.parse(payload) as OwnedJob;

const toChatRecord = (row: UserRow): ChatRecord => ({
  telegramId: row.telegram_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  locale: row.locale ?? null
});

export class D1ChatRegistry extends D1BaseClient implements ChatRegistry {
  private readonly ready: Promise<void>;

  constructor(
    accountId: string,
    databaseId: string,
    apiToken: string,
    fetchImpl: typeof fetch = fetch,
    baseUrl = 'https://api.cloudflare.com/client/v4'
  ) {
    super(accountId, databaseId, apiToken, fetchImpl, baseUrl);
    this.ready = this.initSchema();
  }

  async registerChat(telegramId: string): Promise<ChatRecord> {
    await this.ready;
    const timestamp = new Date().toISOString();
    await this.execute(
      `
      INSERT INTO users (telegram_id, locale, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        updated_at = excluded.updated_at
    `.trim(),
      [telegramId, null, timestamp, timestamp]
    );
    const row = await this.getUserRow(telegramId);
    if (!row) {
      throw new Error(`Failed to load user ${telegramId} after upsert`);
    }
    return toChatRecord(row);
  }

  async listJobs(telegramId: string): Promise<OwnedJob[]> {
    await this.ready;
    const rows = await this.query<JobRow>('SELECT * FROM jobs WHERE telegram_id = ? ORDER BY created_at DESC', [telegramId]);
    return rows.map((row) => deserializeJob(row.payload));
  }

  async listAllJobs(): Promise<OwnedJob[]> {
    await this.ready;
    const rows = await this.query<JobRow>('SELECT * FROM jobs ORDER BY created_at DESC');
    return rows.map((row) => deserializeJob(row.payload));
  }

  async getJob(jobId: string): Promise<OwnedJob | undefined> {
    await this.ready;
    const rows = await this.query<JobRow>('SELECT * FROM jobs WHERE job_id = ?', [jobId]);
    const row = rows[0];
    return row ? deserializeJob(row.payload) : undefined;
  }

  async bindJobToChat(job: StoredJob, telegramId: string): Promise<OwnedJob> {
    await this.ready;
    const owned: OwnedJob = { ...job, telegramId };
    await this.saveJob(owned);
    return owned;
  }

  async updateJob(job: OwnedJob): Promise<void> {
    await this.ready;
    await this.saveJob(job);
  }

  async deleteJob(jobId: string): Promise<void> {
    await this.ready;
    await this.execute('DELETE FROM jobs WHERE job_id = ?', [jobId]);
  }

  async getNotificationTargets(jobId: string): Promise<ChatNotificationTarget[]> {
    await this.ready;
    const rows = await this.query<UserRow>(
      `
      SELECT u.*
      FROM jobs j
      JOIN users u ON u.telegram_id = j.telegram_id
      WHERE j.job_id = ?
    `.trim(),
      [jobId]
    );
    return rows.map((row) => ({
      telegramId: row.telegram_id,
      locale: row.locale ?? null
    }));
  }

  async getChatLocale(telegramId: string): Promise<string | null> {
    await this.ready;
    const rows = await this.query<{ locale: string | null }>('SELECT locale FROM users WHERE telegram_id = ?', [telegramId]);
    return rows[0]?.locale ?? null;
  }

  async setChatLocale(telegramId: string, locale: string | null): Promise<void> {
    await this.ready;
    const timestamp = new Date().toISOString();
    await this.execute(
      `
      UPDATE users
      SET locale = ?,
          updated_at = ?
      WHERE telegram_id = ?
    `.trim(),
      [locale, timestamp, telegramId]
    );
  }

  private async initSchema(): Promise<void> {
    const statements = [
      `
      CREATE TABLE IF NOT EXISTS users (
        telegram_id TEXT PRIMARY KEY,
        locale TEXT,
        subscription_expires_at TEXT,
        demo_used INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `.trim(),
      `
      CREATE TABLE IF NOT EXISTS jobs (
        job_id TEXT PRIMARY KEY,
        telegram_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (telegram_id) REFERENCES users(telegram_id) ON DELETE CASCADE
      )
    `.trim(),
      'CREATE INDEX IF NOT EXISTS jobs_telegram_id_idx ON jobs(telegram_id)'
    ];
    for (const sql of statements) {
      await this.execute(sql);
    }
    await this.ensureSubscriptionColumn();
    await this.ensureDemoUsedColumn();
  }

  private async saveJob(job: OwnedJob): Promise<void> {
    const timestamp = new Date().toISOString();
    await this.execute(
      `
      INSERT INTO jobs (job_id, telegram_id, payload, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(job_id) DO UPDATE SET
        telegram_id = excluded.telegram_id,
        payload = excluded.payload,
        updated_at = excluded.updated_at
    `.trim(),
      [job.jobId, job.telegramId, serializeJob(job), timestamp, timestamp]
    );
  }

  private async getUserRow(telegramId: string): Promise<UserRow | undefined> {
    const rows = await this.query<UserRow>('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
    return rows[0];
  }
}
