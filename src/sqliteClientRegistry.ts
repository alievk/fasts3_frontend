import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
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

const ensureDirectory = (filePath: string): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
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

export class SQLiteClientRegistry implements ClientRegistry {
  private db: Database.Database;

  private upsertClientStmt: Database.Statement;
  private getClientStmt: Database.Statement;
  private listJobsStmt: Database.Statement;
  private listAllJobsStmt: Database.Statement;
  private getJobStmt: Database.Statement;
  private upsertJobStmt: Database.Statement;
  private deleteJobStmt: Database.Statement;
  private notificationTargetsStmt: Database.Statement;
  private getClientLocaleStmt: Database.Statement;
  private setClientLocaleStmt: Database.Statement;

  constructor(private readonly dbPath: string) {
    ensureDirectory(dbPath);
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initSchema();
    this.upsertClientStmt = this.db.prepare(
      `
      INSERT INTO clients (client_id, transport_type, transport_payload, locale, created_at, updated_at)
      VALUES (@clientId, @transportType, @payload, @locale, @createdAt, @updatedAt)
      ON CONFLICT(client_id) DO UPDATE SET
        transport_type = excluded.transport_type,
        transport_payload = excluded.transport_payload,
        updated_at = excluded.updated_at
    `.trim()
    );
    this.getClientStmt = this.db.prepare('SELECT * FROM clients WHERE client_id = ?');
    this.listJobsStmt = this.db.prepare('SELECT * FROM jobs WHERE client_id = ? ORDER BY created_at DESC');
    this.listAllJobsStmt = this.db.prepare('SELECT * FROM jobs ORDER BY created_at DESC');
    this.getJobStmt = this.db.prepare('SELECT * FROM jobs WHERE job_id = ?');
    this.upsertJobStmt = this.db.prepare(
      `
      INSERT INTO jobs (job_id, client_id, payload, created_at, updated_at)
      VALUES (@jobId, @clientId, @payload, @createdAt, @updatedAt)
      ON CONFLICT(job_id) DO UPDATE SET
        client_id = excluded.client_id,
        payload = excluded.payload,
        updated_at = excluded.updated_at
    `.trim()
    );
    this.deleteJobStmt = this.db.prepare('DELETE FROM jobs WHERE job_id = ?');
    this.notificationTargetsStmt = this.db.prepare(
      `
      SELECT c.*
      FROM jobs j
      JOIN clients c ON c.client_id = j.client_id
      WHERE j.job_id = ?
    `.trim()
    );
    this.getClientLocaleStmt = this.db.prepare('SELECT locale FROM clients WHERE client_id = ?');
    this.setClientLocaleStmt = this.db.prepare(
      `
      UPDATE clients
      SET locale = @locale,
          updated_at = @updatedAt
      WHERE client_id = @clientId
    `.trim()
    );
  }

  async registerClient(clientId: string, transport: ClientTransport): Promise<ClientRecord> {
    const timestamp = new Date().toISOString();
    this.upsertClientStmt.run({
      clientId,
      transportType: transport.type,
      payload: serializeTransport(transport),
      locale: null,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    const row = this.getClientStmt.get(clientId) as ClientRow | undefined;
    if (!row) {
      throw new Error(`Failed to load client ${clientId} after upsert`);
    }
    return toClientRecord(row);
  }

  async listJobs(clientId: string): Promise<OwnedJob[]> {
    const rows = this.listJobsStmt.all(clientId) as JobRow[];
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

  async bindJobToClient(job: StoredJob, clientId: string): Promise<OwnedJob> {
    const owned: OwnedJob = { ...job, clientId };
    await this.saveJob(owned);
    return owned;
  }

  async updateJob(job: OwnedJob): Promise<void> {
    await this.saveJob(job);
  }

  async deleteJob(jobId: string): Promise<void> {
    this.deleteJobStmt.run(jobId);
  }

  async getNotificationTargets(jobId: string): Promise<ClientNotificationTarget[]> {
    const rows = this.notificationTargetsStmt.all(jobId) as ClientRow[];
    return rows.map((row) => ({
      clientId: row.client_id,
      transport: deserializeTransport(row.transport_payload),
      locale: row.locale ?? null
    }));
  }

  async getClientLocale(clientId: string): Promise<string | null> {
    const row = this.getClientLocaleStmt.get(clientId) as { locale: string | null } | undefined;
    return row?.locale ?? null;
  }

  async setClientLocale(clientId: string, locale: string | null): Promise<void> {
    const timestamp = new Date().toISOString();
    this.setClientLocaleStmt.run({
      clientId,
      locale,
      updatedAt: timestamp
    });
  }

  private initSchema(): void {
    this.db.exec(
      `
      CREATE TABLE IF NOT EXISTS clients (
        client_id TEXT PRIMARY KEY,
        transport_type TEXT NOT NULL,
        transport_payload TEXT NOT NULL,
        locale TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS jobs (
        job_id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (client_id) REFERENCES clients(client_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS jobs_client_id_idx ON jobs(client_id);
    `.trim()
    );
  }

  private async saveJob(job: OwnedJob): Promise<void> {
    const timestamp = new Date().toISOString();
    this.upsertJobStmt.run({
      jobId: job.jobId,
      clientId: job.clientId,
      payload: serializeJob(job),
      createdAt: timestamp,
      updatedAt: timestamp
    });
  }
}
