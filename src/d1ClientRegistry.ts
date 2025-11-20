import {
  ClientNotificationTarget,
  ClientRecord,
  ClientRegistry,
  ClientTransport,
  OwnedJob,
  StoredJob
} from './types.js';

type ClientRow = {
  client_id: string;
  transport_type: string;
  transport_payload: string;
  created_at: string;
  updated_at: string;
  locale: string | null;
};

type JobRow = {
  job_id: string;
  client_id: string;
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

const serializeTransport = (transport: ClientTransport): string => JSON.stringify(transport);
const deserializeTransport = (payload: string): ClientTransport => JSON.parse(payload) as ClientTransport;

const serializeJob = (job: OwnedJob): string => JSON.stringify(job);
const deserializeJob = (payload: string): OwnedJob => JSON.parse(payload) as OwnedJob;

const toClientRecord = (row: ClientRow): ClientRecord => ({
  clientId: row.client_id,
  transport: deserializeTransport(row.transport_payload),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  locale: row.locale ?? null
});

export class D1ClientRegistry implements ClientRegistry {
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

  async registerClient(clientId: string, transport: ClientTransport): Promise<ClientRecord> {
    await this.ready;
    const timestamp = new Date().toISOString();
    await this.execute(
      `
      INSERT INTO clients (client_id, transport_type, transport_payload, locale, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(client_id) DO UPDATE SET
        transport_type = excluded.transport_type,
        transport_payload = excluded.transport_payload,
        updated_at = excluded.updated_at
    `.trim(),
      [clientId, transport.type, serializeTransport(transport), null, timestamp, timestamp]
    );
    const row = await this.getClientRow(clientId);
    if (!row) {
      throw new Error(`Failed to load client ${clientId} after upsert`);
    }
    return toClientRecord(row);
  }

  async listJobs(clientId: string): Promise<OwnedJob[]> {
    await this.ready;
    const rows = await this.query<JobRow>('SELECT * FROM jobs WHERE client_id = ? ORDER BY created_at DESC', [clientId]);
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

  async bindJobToClient(job: StoredJob, clientId: string): Promise<OwnedJob> {
    await this.ready;
    const owned: OwnedJob = { ...job, clientId };
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

  async getNotificationTargets(jobId: string): Promise<ClientNotificationTarget[]> {
    await this.ready;
    const rows = await this.query<ClientRow>(
      `
      SELECT c.*
      FROM jobs j
      JOIN clients c ON c.client_id = j.client_id
      WHERE j.job_id = ?
    `.trim(),
      [jobId]
    );
    return rows.map((row) => ({
      clientId: row.client_id,
      transport: deserializeTransport(row.transport_payload),
      locale: row.locale ?? null
    }));
  }

  async getClientLocale(clientId: string): Promise<string | null> {
    await this.ready;
    const rows = await this.query<{ locale: string | null }>('SELECT locale FROM clients WHERE client_id = ?', [clientId]);
    return rows[0]?.locale ?? null;
  }

  async setClientLocale(clientId: string, locale: string | null): Promise<void> {
    await this.ready;
    const timestamp = new Date().toISOString();
    await this.execute(
      `
      UPDATE clients
      SET locale = ?,
          updated_at = ?
      WHERE client_id = ?
    `.trim(),
      [locale, timestamp, clientId]
    );
  }

  private async initSchema(): Promise<void> {
    const statements = [
      `
      CREATE TABLE IF NOT EXISTS clients (
        client_id TEXT PRIMARY KEY,
        transport_type TEXT NOT NULL,
        transport_payload TEXT NOT NULL,
        locale TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `.trim(),
      `
      CREATE TABLE IF NOT EXISTS jobs (
        job_id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (client_id) REFERENCES clients(client_id) ON DELETE CASCADE
      )
    `.trim(),
      'CREATE INDEX IF NOT EXISTS jobs_client_id_idx ON jobs(client_id)'
    ];
    for (const sql of statements) {
      await this.execute(sql);
    }
  }

  private async saveJob(job: OwnedJob): Promise<void> {
    const timestamp = new Date().toISOString();
    await this.execute(
      `
      INSERT INTO jobs (job_id, client_id, payload, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(job_id) DO UPDATE SET
        client_id = excluded.client_id,
        payload = excluded.payload,
        updated_at = excluded.updated_at
    `.trim(),
      [job.jobId, job.clientId, serializeJob(job), timestamp, timestamp]
    );
  }

  private async getClientRow(clientId: string): Promise<ClientRow | undefined> {
    const rows = await this.query<ClientRow>('SELECT * FROM clients WHERE client_id = ?', [clientId]);
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
}
