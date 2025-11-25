import { ChatNotificationTarget, ChatRecord, ChatRegistry, OwnedJob, StoredJob } from './types.js';

const now = (): string => new Date().toISOString();

const sortJobs = (jobs: OwnedJob[]): OwnedJob[] => [...jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

export class MemoryChatRegistry implements ChatRegistry {
  private chats = new Map<string, ChatRecord>();
  private jobs = new Map<string, OwnedJob>();

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
}
