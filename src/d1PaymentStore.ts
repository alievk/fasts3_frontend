import type { PaymentOrder, PaymentPlan, PaymentStatus } from './types.js';

type PlanRow = {
  id: number;
  name: string;
  price: number;
  duration_days: number;
  display: number;
};

type OrderRow = {
  id: number;
  user_id: string;
  plan_id: number;
  amount: number;
  provider: string;
  external_id: string | null;
  status: string;
  created_at: string;
  paid_at: string | null;
};

type SubscriptionRow = {
  subscription_expires_at: string | null;
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

const toPaymentPlan = (row: PlanRow): PaymentPlan => ({
  id: row.id,
  name: row.name,
  price: row.price,
  durationDays: row.duration_days,
  display: row.display !== 0
});

const toPaymentOrder = (row: OrderRow): PaymentOrder => ({
  id: row.id,
  userId: row.user_id,
  planId: row.plan_id,
  amount: row.amount,
  provider: row.provider,
  externalId: row.external_id,
  status: row.status as PaymentStatus,
  createdAt: row.created_at,
  paidAt: row.paid_at ?? null
});

export class D1PaymentStore {
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

  async getOrder(orderId: number): Promise<PaymentOrder | undefined> {
    await this.ready;
    const rows = await this.query<OrderRow>('SELECT * FROM orders WHERE id = ?', [orderId]);
    const row = rows[0];
    return row ? toPaymentOrder(row) : undefined;
  }

  async getPlan(planId: number): Promise<PaymentPlan | undefined> {
    await this.ready;
    const rows = await this.query<PlanRow>('SELECT * FROM plans WHERE id = ?', [planId]);
    const row = rows[0];
    return row ? toPaymentPlan(row) : undefined;
  }

  async findPendingOrder(userId: string, planId: number, provider: string): Promise<PaymentOrder | undefined> {
    await this.ready;
    const rows = await this.query<OrderRow>(
      `
      SELECT *
      FROM orders
      WHERE user_id = ?
        AND plan_id = ?
        AND provider = ?
        AND status = 'pending'
      ORDER BY created_at DESC
      LIMIT 1
    `.trim(),
      [userId, planId, provider]
    );
    const row = rows[0];
    return row ? toPaymentOrder(row) : undefined;
  }

  async listVisiblePlans(): Promise<PaymentPlan[]> {
    await this.ready;
    const rows = await this.query<PlanRow>('SELECT * FROM plans WHERE display != 0 ORDER BY id');
    return rows.map(toPaymentPlan);
  }

  async markOrderPaid(orderId: number, paidAt: string): Promise<void> {
    await this.ready;
    await this.execute(
      `
      UPDATE orders
      SET status = 'paid',
          paid_at = ?
      WHERE id = ?
    `.trim(),
      [paidAt, orderId]
    );
  }

  async getSubscriptionExpiresAt(telegramId: string): Promise<string | null> {
    await this.ready;
    const rows = await this.query<SubscriptionRow>(
      'SELECT subscription_expires_at FROM users WHERE telegram_id = ?',
      [telegramId]
    );
    const raw = rows[0]?.subscription_expires_at;
    return raw ?? null;
  }

  async setSubscriptionExpiresAt(telegramId: string, expiresAt: string | null, timestamp: string): Promise<void> {
    await this.ready;
    await this.execute(
      `
      INSERT INTO users (telegram_id, subscription_expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        subscription_expires_at = excluded.subscription_expires_at,
        updated_at = excluded.updated_at
    `.trim(),
      [telegramId, expiresAt, timestamp, timestamp]
    );
  }

  async createOrder(params: {
    userId: string;
    planId: number;
    amount: number;
    provider: string;
    externalId?: string | null;
    status?: PaymentStatus;
    createdAt?: string;
  }): Promise<PaymentOrder> {
    await this.ready;
    const createdAt = params.createdAt ?? new Date().toISOString();
    const status = params.status ?? 'pending';
    await this.execute(
      `
      INSERT INTO orders (user_id, plan_id, amount, provider, external_id, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `.trim(),
      [params.userId, params.planId, params.amount, params.provider, params.externalId ?? null, status, createdAt]
    );
    const rows = await this.query<OrderRow>('SELECT * FROM orders WHERE rowid = last_insert_rowid()');
    const row = rows[0];
    if (!row) {
      throw new Error('Failed to fetch created order');
    }
    return toPaymentOrder(row);
  }

  async setOrderExternalId(orderId: number, externalId: string): Promise<void> {
    await this.ready;
    await this.execute('UPDATE orders SET external_id = ? WHERE id = ?', [externalId, orderId]);
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
      CREATE TABLE IF NOT EXISTS plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        price REAL NOT NULL,
        duration_days INTEGER NOT NULL,
        display INTEGER NOT NULL DEFAULT 1
      )
    `.trim(),
      `
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        plan_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        provider TEXT NOT NULL,
        external_id TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        paid_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(telegram_id),
        FOREIGN KEY (plan_id) REFERENCES plans(id)
      )
    `.trim(),
      'CREATE INDEX IF NOT EXISTS orders_user_id_idx ON orders(user_id)',
      'CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(status)'
    ];
    for (const sql of statements) {
      await this.execute(sql);
    }
    await this.ensureSubscriptionColumn();
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
