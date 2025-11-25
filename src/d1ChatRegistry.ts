import { ChatNotificationTarget, ChatRecord, ChatRegistry, OwnedJob, StoredJob } from './types.js';

type UserRow = {
  telegram_id: string;
  created_at: string;
  updated_at: string;
  locale: string | null;
  subscription_expires_at?: string | null;
};

type JobRow = {
  job_id: string;
  telegram_id: string;
  payload: string;
  created_at: string;
  updated_at: string;
};

type D1QueryResult = {
  success?: boolean;
  error?: string;
  results?: Array<Record<string, unknown>>;
};

type D1ResponseError = { message?: string };

type D1Response = {
  success: boolean;
  errors?: D1ResponseError[];
  result?: D1QueryResult[];
};

const serializeJob = (job: OwnedJob): string => JSON.stringify(job);
const deserializeJob = (payload: string): OwnedJob => JSON.parse(payload) as OwnedJob;

const toChatRecord = (row: UserRow): ChatRecord => ({
  telegramId: row.telegram_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  locale: row.locale ?? null
});

export class D1ChatRegistry implements ChatRegistry {
  private readonly endpoint: string;
  private readonly ready: Promise<void>;

  constructor(
    private readonly accountId: string,
    private readonly databaseId: string,
    private readonly apiToken: string,
    private readonly fetchImpl: typeof fetch = fetch,
    baseUrl = 'https://api.cloudflare.com/client/v4'
  ) {
    this.endpoint = `${baseUrl.replace(/\/$/, '')}/accounts/${accountId}/d1/database/${databaseId}/query`;
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

  private async query<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.execute(sql, params);
    return (result.results ?? []) as T[];
  }

  private async execute(sql: string, params: unknown[] = []): Promise<D1QueryResult> {
    const response = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({ sql, params })
    });
    const text = await response.text();
    if (!response.ok) {
      const detail = text || response.statusText;
      throw new Error(`D1 request failed: ${detail}`);
    }

    let payload: D1Response;
    try {
      payload = text ? (JSON.parse(text) as D1Response) : { success: false };
    } catch {
      throw new Error('Failed to parse D1 response');
    }

    const error = this.extractError(payload);
    if (error) {
      throw new Error(error);
    }
    const first = payload.result?.[0];
    return first ?? { results: [] };
  }

  private buildHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };
  }

  private extractError(payload: D1Response): string | undefined {
    if (!payload.success) {
      return payload.errors?.[0]?.message ?? 'D1 query failed';
    }
    const first = payload.result?.[0];
    if (first?.error) {
      return first.error;
    }
    if (first?.success === false) {
      return 'D1 query failed';
    }
    return undefined;
  }

  private async ensureSubscriptionColumn(): Promise<void> {
    try {
      await this.execute('ALTER TABLE users ADD COLUMN subscription_expires_at TEXT');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/duplicate column name/i.test(message)) {
        throw error;
      }
    }
  }
}
