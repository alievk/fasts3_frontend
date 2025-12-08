import { ChatNotificationTarget, ChatRecord, ChatRegistry, OwnedJob, StoredJob } from './types.js';
import { D1BaseClient } from './d1BaseClient.js';

type UserRow = {
  telegram_id: string;
  created_at: string;
  updated_at: string;
  locale: string | null;
  provider: string | null;
  source: string | null;
  subscription_expires_at?: string | null;
  demo_used?: number | null;
  weekly_quota_gb?: number | null;
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
  locale: row.locale ?? null,
  source: row.source ?? null
});

export class D1ChatRegistry extends D1BaseClient implements ChatRegistry {
  private readonly ready: Promise<void>;
  private readonly defaultWeeklyQuotaGb: number | undefined;

  constructor(
    accountId: string,
    databaseId: string,
    apiToken: string,
    defaultWeeklyQuotaGb?: number,
    fetchImpl: typeof fetch = fetch,
    baseUrl = 'https://api.cloudflare.com/client/v4'
  ) {
    super(accountId, databaseId, apiToken, fetchImpl, baseUrl);
    this.defaultWeeklyQuotaGb = defaultWeeklyQuotaGb;
    this.ready = this.initSchema();
  }

  async registerChat(telegramId: string, source?: string | null): Promise<ChatRecord> {
    await this.ready;
    const timestamp = new Date().toISOString();
    if (source === undefined) {
      await this.execute(
        `
        INSERT INTO users (telegram_id, locale, weekly_quota_gb, source, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(telegram_id) DO UPDATE SET
          updated_at = excluded.updated_at
      `.trim(),
        [telegramId, null, this.defaultWeeklyQuotaGb ?? null, null, timestamp, timestamp]
      );
    } else {
      await this.execute(
        `
        INSERT INTO users (telegram_id, locale, weekly_quota_gb, source, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(telegram_id) DO UPDATE SET
          updated_at = excluded.updated_at,
          source = excluded.source
      `.trim(),
        [telegramId, null, this.defaultWeeklyQuotaGb ?? null, source, timestamp, timestamp]
      );
    }
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

  async deleteUser(telegramId: string): Promise<boolean> {
    await this.ready;
    const row = await this.getUserRow(telegramId);
    if (!row) return false;
    await this.execute('DELETE FROM download_history WHERE telegram_id = ?', [telegramId]);
    await this.execute('DELETE FROM jobs WHERE telegram_id = ?', [telegramId]);
    await this.execute('DELETE FROM users WHERE telegram_id = ?', [telegramId]);
    return true;
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

  async getChatProvider(telegramId: string): Promise<string | null> {
    await this.ready;
    const rows = await this.query<{ provider: string | null }>('SELECT provider FROM users WHERE telegram_id = ?', [telegramId]);
    return rows[0]?.provider ?? null;
  }

  async setChatProvider(telegramId: string, provider: string | null): Promise<void> {
    await this.ready;
    const timestamp = new Date().toISOString();
    await this.execute(
      `
      UPDATE users
      SET provider = ?,
          updated_at = ?
      WHERE telegram_id = ?
    `.trim(),
      [provider, timestamp, telegramId]
    );
  }

  async recordDownload(telegramId: string, jobId: string, hash: string, sizeBytes: number): Promise<void> {
    await this.ready;
    const timestamp = new Date().toISOString();
    await this.execute(
      'INSERT INTO download_history (telegram_id, job_id, hash, size_bytes, completed_at) VALUES (?, ?, ?, ?, ?)',
      [telegramId, jobId, hash, sizeBytes, timestamp]
    );
  }

  async getUsageBytes(telegramId: string, days: number): Promise<number> {
    await this.ready;
    const rows = await this.query<{ total: number | null }>(
      `SELECT SUM(max_size) as total FROM (
        SELECT hash, MAX(size_bytes) as max_size 
        FROM download_history 
        WHERE telegram_id = ? AND completed_at > datetime('now', '-' || ? || ' days')
        GROUP BY hash
      )`,
      [telegramId, days]
    );
    return rows[0]?.total ?? 0;
  }

  async getOldestDownloadDate(telegramId: string, days: number): Promise<Date | null> {
    await this.ready;
    const rows = await this.query<{ oldest: string | null }>(
      `SELECT MIN(completed_at) as oldest FROM download_history WHERE telegram_id = ? AND completed_at > datetime('now', '-' || ? || ' days')`,
      [telegramId, days]
    );
    const oldest = rows[0]?.oldest;
    return oldest ? new Date(oldest) : null;
  }

  async getUserQuota(telegramId: string): Promise<number | null> {
    await this.ready;
    const rows = await this.query<{ weekly_quota_gb: number | null }>('SELECT weekly_quota_gb FROM users WHERE telegram_id = ?', [telegramId]);
    return rows[0]?.weekly_quota_gb ?? null;
  }

  async setUserQuota(telegramId: string, quotaGb: number | null): Promise<void> {
    await this.ready;
    const timestamp = new Date().toISOString();
    await this.execute(
      'UPDATE users SET weekly_quota_gb = ?, updated_at = ? WHERE telegram_id = ?',
      [quotaGb, timestamp, telegramId]
    );
  }

  private async initSchema(): Promise<void> {
    const statements = [
      D1BaseClient.USERS_TABLE_SQL,
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
      'CREATE INDEX IF NOT EXISTS jobs_telegram_id_idx ON jobs(telegram_id)',
      `
      CREATE TABLE IF NOT EXISTS download_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_id TEXT NOT NULL,
        job_id TEXT NOT NULL,
        hash TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        completed_at TEXT NOT NULL,
        FOREIGN KEY (telegram_id) REFERENCES users(telegram_id) ON DELETE CASCADE
      )
    `.trim(),
      'CREATE INDEX IF NOT EXISTS download_history_user_date_idx ON download_history(telegram_id, completed_at)'
    ];
    for (const sql of statements) {
      await this.execute(sql);
    }
    await this.ensureUserColumns();
    await this.ensureColumn('users', 'weekly_quota_gb', 'REAL');
    await this.ensureColumn('users', 'provider', 'TEXT');
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
