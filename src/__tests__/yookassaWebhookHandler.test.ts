import assert from 'node:assert/strict';
import { test } from 'node:test';
import { D1PaymentStore } from '../d1PaymentStore.js';
import { createYookassaWebhookHandler } from '../yookassaWebhookHandler.js';
import type { PaymentOrder } from '../types.js';

type FakeUserRow = {
  telegram_id: string;
  locale: string | null;
  subscription_expires_at: string | null;
  demo_used: number;
  created_at: string;
  updated_at: string;
};

type FakePlanRow = {
  id: number;
  name: string;
  price: number;
  duration_days: number;
  display: number;
};

type FakeOrderRow = {
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

const buildFetchStub = (plan: FakePlanRow) => {
  const users = new Map<string, FakeUserRow>();
  const plans = new Map<number, FakePlanRow>([[plan.id, plan]]);
  const orders = new Map<number, FakeOrderRow>();
  const telegramMessages: unknown[] = [];

  let lastOrderId = 0;

  const response = (results: unknown[]) =>
    new Response(
      JSON.stringify({
        success: true,
        errors: [],
        result: [{ success: true, results }]
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  const telegramResponse = () => new Response(JSON.stringify({ ok: true }), { status: 200 });

  const handler = async (url: string, init?: RequestInit) => {
    if (url.includes('api.telegram.org')) {
      const bodyText = typeof init?.body === 'string' ? init.body : init?.body?.toString() ?? '{}';
      try {
        telegramMessages.push(JSON.parse(bodyText));
      } catch {
        telegramMessages.push(bodyText);
      }
      return telegramResponse();
    }

    const rawBody = init?.body ?? '{}';
    const bodyText = typeof rawBody === 'string' ? rawBody : rawBody?.toString() ?? '{}';
    const payload = JSON.parse(bodyText);
    const sql: string = payload.sql ?? '';
    const params: unknown[] = Array.isArray(payload.params) ? payload.params : [];
    const normalized = sql.trim().toLowerCase();

    if (normalized.startsWith('create table') || normalized.startsWith('create index')) {
      return response([]);
    }

    if (normalized.startsWith('alter table users add column subscription_expires_at')) {
      return response([]);
    }

    if (normalized.startsWith('alter table users add column demo_used')) {
      return response([]);
    }

    if (normalized.startsWith('alter table users add column source')) {
      return response([]);
    }

    if (normalized.startsWith('select * from plans where id')) {
      const [id] = params as [number];
      const row = plans.get(Number(id));
      return response(row ? [row] : []);
    }

    if (normalized.startsWith('insert into orders')) {
      const [userId, planId, amount, provider, externalId, status, createdAt] = params as [
        string,
        number,
        number,
        string,
        string | null,
        string,
        string
      ];
      const id = ++lastOrderId;
      orders.set(id, {
        id,
        user_id: userId,
        plan_id: Number(planId),
        amount: Number(amount),
        provider,
        external_id: externalId ?? null,
        status,
        created_at: createdAt,
        paid_at: null
      });
      return response([]);
    }

    if (normalized.startsWith('select * from orders where rowid')) {
      const row = orders.get(lastOrderId);
      return response(row ? [row] : []);
    }

    if (normalized.startsWith('select * from orders where id')) {
      const [id] = params as [number];
      const row = orders.get(Number(id));
      return response(row ? [row] : []);
    }

    if (normalized.startsWith('update orders')) {
      const [paidAt, id] = params as [string, number];
      const order = orders.get(Number(id));
      if (order) {
        orders.set(order.id, { ...order, paid_at: paidAt, status: 'paid' });
      }
      return response([]);
    }

    if (normalized.startsWith('select subscription_expires_at from users')) {
      const [telegramId] = params as [string];
      const row = users.get(telegramId);
      return response(row ? [{ subscription_expires_at: row.subscription_expires_at ?? null }] : []);
    }

    if (normalized.startsWith('select locale from users')) {
      const [telegramId] = params as [string];
      const row = users.get(telegramId);
      return response(row ? [{ locale: row.locale ?? null }] : []);
    }

    if (normalized.startsWith('insert into users')) {
      const [telegramId, subscriptionExpiresAt, createdAt, updatedAt] = params as [
        string,
        string | null,
        string,
        string
      ];
      const existing = users.get(telegramId);
      const next: FakeUserRow = {
        telegram_id: telegramId,
        locale: existing?.locale ?? null,
        subscription_expires_at: subscriptionExpiresAt ?? null,
        demo_used: existing?.demo_used ?? 0,
        created_at: existing?.created_at ?? createdAt,
        updated_at: updatedAt
      };
      users.set(telegramId, next);
      return response([]);
    }

    throw new Error(`Unhandled SQL in stub: ${sql}`);
  };

  return { fetch: handler, users, plans, orders, telegramMessages };
};

const buildHandler = async (fetchStub: ReturnType<typeof buildFetchStub>, plan: FakePlanRow) => {
  const store = new D1PaymentStore('acc', 'db', 'token', fetchStub.fetch as any);
  const order = await store.createOrder({
    userId: '123',
    planId: plan.id,
    amount: plan.price,
    provider: 'yookassa'
  });
  const handler = createYookassaWebhookHandler({
    store,
    botToken: 'telegram-token',
    timezone: 'UTC'
  });
  return { handler, store, order, plan };
};

const runWebhook = async (handler: ReturnType<typeof createYookassaWebhookHandler>, order: PaymentOrder, path: string) => {
  await handler({
    path,
    ip: '1.2.3.4',
    headers: {},
    body: {
      event: 'payment.succeeded',
      object: {
        metadata: { internal_order_id: order.id }
      }
    }
  });
};

test('marks order paid and extends subscription', async () => {
  const plan: FakePlanRow = { id: 1, name: 'Plan', price: 100, duration_days: 30, display: 1 };
  const stub = buildFetchStub(plan);
  const originalFetch = global.fetch;
  (global as any).fetch = stub.fetch;
  try {
    const { handler, store, order } = await buildHandler(stub, plan);
    await runWebhook(handler, order, '/payment/yookassa');

    const updatedOrder = await store.getOrder(order.id);
    assert.equal(updatedOrder?.status, 'paid');
    assert.ok(updatedOrder?.paidAt);

    const subscription = await store.getSubscriptionExpiresAt(order.userId);
    assert.ok(subscription);
    const expiresAt = subscription ? new Date(subscription) : null;
    const diffMs = expiresAt ? expiresAt.getTime() - Date.now() : 0;
    const expectedMs = plan.duration_days * 24 * 60 * 60 * 1000;
    assert.ok(diffMs > expectedMs - 60000 && diffMs < expectedMs + 60000);

    const sent = stub.telegramMessages[0] as { text?: string } | undefined;
    assert.ok(sent?.text?.includes('Оплата получена'));
  } finally {
    (global as any).fetch = originalFetch;
  }
});

test('rolls back subscription for test endpoint', async () => {
  const plan: FakePlanRow = { id: 1, name: 'Plan', price: 100, duration_days: 30, display: 1 };
  const stub = buildFetchStub(plan);
  const originalFetch = global.fetch;
  (global as any).fetch = stub.fetch;
  try {
    const { handler, store, order } = await buildHandler(stub, plan);
  const baseDate = new Date('2030-01-01T00:00:00.000Z').toISOString();
  await store.setSubscriptionExpiresAt(order.userId, baseDate, new Date('2029-12-01T00:00:00.000Z').toISOString());

    await runWebhook(handler, order, '/payment/yookassa_test');

  const subscription = await store.getSubscriptionExpiresAt(order.userId);
  assert.notEqual(subscription, baseDate);

  const sent = stub.telegramMessages[0] as { text?: string } | undefined;
  assert.ok(sent?.text?.startsWith('[test] <b>Оплата получена'));
  } finally {
    (global as any).fetch = originalFetch;
  }
});
