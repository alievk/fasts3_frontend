import { ClientNotificationTarget, ClientRecord, ClientRegistry, ClientTransport, OwnedJob, StoredJob } from './types.js';

const now = (): string => new Date().toISOString();

const sortJobs = (jobs: OwnedJob[]): OwnedJob[] => [...jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

export class MemoryClientRegistry implements ClientRegistry {
  private clients = new Map<string, ClientRecord>();
  private jobs = new Map<string, OwnedJob>();

  async registerClient(clientId: string, transport: ClientTransport): Promise<ClientRecord> {
    const existing = this.clients.get(clientId);
    const record: ClientRecord = {
      clientId,
      transport,
      createdAt: existing?.createdAt ?? now(),
      updatedAt: now(),
      locale: existing?.locale ?? null
    };
    this.clients.set(clientId, record);
    return record;
  }

  async listJobs(clientId: string): Promise<OwnedJob[]> {
    return sortJobs(
      [...this.jobs.values()].filter((job) => job.clientId === clientId)
    );
  }

  async listAllJobs(): Promise<OwnedJob[]> {
    return sortJobs([...this.jobs.values()]);
  }

  async getJob(jobId: string): Promise<OwnedJob | undefined> {
    return this.jobs.get(jobId);
  }

  async bindJobToClient(job: StoredJob, clientId: string): Promise<OwnedJob> {
    const owned: OwnedJob = { ...job, clientId };
    this.jobs.set(job.jobId, owned);
    return owned;
  }

  async updateJob(job: OwnedJob): Promise<void> {
    this.jobs.set(job.jobId, job);
  }

  async deleteJob(jobId: string): Promise<void> {
    this.jobs.delete(jobId);
  }

  async getNotificationTargets(jobId: string): Promise<ClientNotificationTarget[]> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return [];
    }
    const client = this.clients.get(job.clientId);
    if (!client) {
      return [];
    }
    return [{ clientId: client.clientId, transport: client.transport, locale: client.locale ?? null }];
  }

  async getClientLocale(clientId: string): Promise<string | null> {
    return this.clients.get(clientId)?.locale ?? null;
  }

  async setClientLocale(clientId: string, locale: string | null): Promise<void> {
    const existing = this.clients.get(clientId);
    if (!existing) {
      return;
    }
    this.clients.set(clientId, { ...existing, locale, updatedAt: now() });
  }
}
