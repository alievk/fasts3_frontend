import { ChatNotificationTarget, ChatRecord, ChatRegistry, OwnedJob, StoredJob } from './types.js';

const now = (): string => new Date().toISOString();

const sortJobs = (jobs: OwnedJob[]): OwnedJob[] => [...jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

type DownloadRecord = { telegramId: string; hash: string; sizeBytes: number; completedAt: Date };

export class MemoryChatRegistry implements ChatRegistry {
  private chats = new Map<string, ChatRecord>();
  private jobs = new Map<string, OwnedJob>();
  private downloads: DownloadRecord[] = [];
  private quotas = new Map<string, number | null>();

  async registerChat(telegramId: string): Promise<ChatRecord> {
    const existing = this.chats.get(telegramId);
    const record: ChatRecord = {
      telegramId,
      createdAt: existing?.createdAt ?? now(),
      updatedAt: now(),
      locale: existing?.locale ?? null
    };
    this.chats.set(telegramId, record);
    return record;
  }

  async listJobs(telegramId: string): Promise<OwnedJob[]> {
    return sortJobs(
      [...this.jobs.values()].filter((job) => job.telegramId === telegramId)
    );
  }

  async listAllJobs(): Promise<OwnedJob[]> {
    return sortJobs([...this.jobs.values()]);
  }

  async getJob(jobId: string): Promise<OwnedJob | undefined> {
    return this.jobs.get(jobId);
  }

  async bindJobToChat(job: StoredJob, telegramId: string): Promise<OwnedJob> {
    const owned: OwnedJob = { ...job, telegramId };
    this.jobs.set(job.jobId, owned);
    return owned;
  }

  async updateJob(job: OwnedJob): Promise<void> {
    this.jobs.set(job.jobId, job);
  }

  async deleteJob(jobId: string): Promise<void> {
    this.jobs.delete(jobId);
  }

  async getNotificationTargets(jobId: string): Promise<ChatNotificationTarget[]> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return [];
    }
    const chat = this.chats.get(job.telegramId);
    if (!chat) {
      return [];
    }
    return [{ telegramId: chat.telegramId, locale: chat.locale ?? null }];
  }

  async getChatLocale(telegramId: string): Promise<string | null> {
    return this.chats.get(telegramId)?.locale ?? null;
  }

  async setChatLocale(telegramId: string, locale: string | null): Promise<void> {
    const existing = this.chats.get(telegramId);
    if (!existing) {
      return;
    }
    this.chats.set(telegramId, { ...existing, locale, updatedAt: now() });
  }

  async recordDownload(telegramId: string, _jobId: string, hash: string, sizeBytes: number): Promise<void> {
    this.downloads.push({ telegramId, hash, sizeBytes, completedAt: new Date() });
  }

  async getUsageBytes(telegramId: string, days: number): Promise<number> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const inWindow = this.downloads.filter((d) => d.telegramId === telegramId && d.completedAt > cutoff);
    const byHash = new Map<string, number>();
    for (const d of inWindow) {
      byHash.set(d.hash, Math.max(byHash.get(d.hash) ?? 0, d.sizeBytes));
    }
    return [...byHash.values()].reduce((sum, size) => sum + size, 0);
  }

  async getOldestDownloadDate(telegramId: string, days: number): Promise<Date | null> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const inWindow = this.downloads.filter((d) => d.telegramId === telegramId && d.completedAt > cutoff);
    if (inWindow.length === 0) return null;
    return inWindow.reduce((oldest, d) => (d.completedAt < oldest ? d.completedAt : oldest), inWindow[0].completedAt);
  }

  async getUserQuota(telegramId: string): Promise<number | null> {
    return this.quotas.get(telegramId) ?? null;
  }

  async setUserQuota(telegramId: string, quotaGb: number | null): Promise<void> {
    this.quotas.set(telegramId, quotaGb);
  }
}
