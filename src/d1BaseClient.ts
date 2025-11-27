export type D1QueryResult = {
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

export abstract class D1BaseClient {
  protected readonly endpoint: string;

  constructor(
    accountId: string,
    databaseId: string,
    protected readonly apiToken: string,
    protected readonly fetchImpl: typeof fetch = fetch,
    baseUrl = 'https://api.cloudflare.com/client/v4'
  ) {
    this.endpoint = `${baseUrl.replace(/\/$/, '')}/accounts/${accountId}/d1/database/${databaseId}/query`;
  }

  protected async query<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.execute(sql, params);
    return (result.results ?? []) as T[];
  }

  protected async execute(sql: string, params: unknown[] = []): Promise<D1QueryResult> {
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

  protected async ensureSubscriptionColumn(): Promise<void> {
    try {
      await this.execute('ALTER TABLE users ADD COLUMN subscription_expires_at TEXT');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/duplicate column name/i.test(message)) {
        throw error;
      }
    }
  }

  protected async ensureDemoUsedColumn(): Promise<void> {
    try {
      await this.execute('ALTER TABLE users ADD COLUMN demo_used INTEGER DEFAULT 0');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/duplicate column name/i.test(message)) {
        throw error;
      }
    }
  }
}

