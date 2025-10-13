import { DownloadService } from './downloadService.js';

export class Poller {
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly service: DownloadService, private readonly intervalMs: number) {}

  start(): void {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      void this.service.syncAll();
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
