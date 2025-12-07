import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { D1PaymentStore } from '../d1PaymentStore.js';
import { createWataWebhookHandler } from '../wataWebhookHandler.js';
import type { PaymentOrder, PaymentPlan } from '../types.js';

const buildStore = (order: PaymentOrder, plan: PaymentPlan) => {
  let orderState = { ...order };
  let subscription: string | null = null;
  let lastPaidAt: string | null = null;

  const store = {
    getOrder: async (id: number) => (id === orderState.id ? orderState : undefined),
    getPlan: async (id: number) => (id === plan.id ? plan : undefined),
    markOrderPaid: async (id: number, paidAt: string) => {
      if (id === orderState.id) {
        orderState = { ...orderState, status: 'paid', paidAt };
        lastPaidAt = paidAt;
      }
    },
    getSubscriptionExpiresAt: async () => subscription,
    setSubscriptionExpiresAt: async (_userId: string, expiresAt: string, paidAt: string) => {
      subscription = expiresAt;
      lastPaidAt = paidAt;
    },
    getChatLocale: async () => null
  } satisfies Partial<D1PaymentStore>;

  return {
    store: store as unknown as D1PaymentStore,
    getOrder: () => orderState,
    getSubscription: () => subscription,
    getPaidAt: () => lastPaidAt
  };
};

const buildFetchStub = () => {
  const messages: unknown[] = [];
  const fetchStub = async (_url: string, init?: RequestInit) => {
    if (init?.body) {
      const text = typeof init.body === 'string' ? init.body : JSON.stringify(init.body);
      try {
        messages.push(JSON.parse(text));
      } catch {
        messages.push(text);
      }
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  return { fetchStub, messages };
};

const runHandler = async (path: string) => {
  const { fetchStub, messages } = buildFetchStub();
  const originalFetch = global.fetch;
  (global as any).fetch = fetchStub;
  try {
    const order: PaymentOrder = {
      id: 1,
      userId: 'u1',
      planId: 1,
      amount: 100,
      provider: 'wata',
      externalId: null,
      status: 'pending',
      createdAt: '2030-01-01T00:00:00.000Z',
      paidAt: null
    };
    const plan: PaymentPlan = {
      id: 1,
      labelKey: 'plan',
      price: 100,
      durationDays: 30,
      oldPrice: null,
      display: true
    };
    const { store, getOrder, getSubscription, getPaidAt } = buildStore(order, plan);
    const handler = createWataWebhookHandler({ store, botToken: 'token', timezone: 'UTC' });
    await handler({
      path,
      ip: '1.1.1.1',
      headers: {},
      body: {
        transactionStatus: 'Paid',
        orderId: order.id,
        paymentTime: '2030-01-01T00:00:00.000Z'
      }
    });
    return { getOrder, getSubscription, getPaidAt, messages };
  } finally {
    (global as any).fetch = originalFetch;
  }
};

test('marks order paid and extends subscription for prod route', async () => {
  const { getOrder, getSubscription, getPaidAt, messages } = await runHandler('/payment/wata');
  const updatedOrder = getOrder();
  assert.equal(updatedOrder.status, 'paid');
  assert.ok(getPaidAt());
  assert.ok(getSubscription());
  const text = (messages[0] as { text?: string } | undefined)?.text ?? '';
  assert.ok(!text.startsWith('[test]'), 'should not include test prefix');
});

test('adds test prefix for test route', async () => {
  const { messages } = await runHandler('/payment/wata_test');
  const text = (messages[0] as { text?: string } | undefined)?.text ?? '';
  assert.ok(text.startsWith('[test]'));
});

test('ignores non-paid transactions', async () => {
  const { fetchStub, messages } = buildFetchStub();
  const originalFetch = global.fetch;
  (global as any).fetch = fetchStub;
  try {
    const order: PaymentOrder = {
      id: 2,
      userId: 'u2',
      planId: 1,
      amount: 100,
      provider: 'wata',
      externalId: null,
      status: 'pending',
      createdAt: '2030-01-01T00:00:00.000Z',
      paidAt: null
    };
    const plan: PaymentPlan = {
      id: 1,
      labelKey: 'plan',
      price: 100,
      durationDays: 30,
      oldPrice: null,
      display: true
    };
    const { store, getOrder, getSubscription, getPaidAt } = buildStore(order, plan);
    const handler = createWataWebhookHandler({ store, botToken: 'token', timezone: 'UTC' });
    await handler({
      path: '/payment/wata',
      ip: '1.1.1.1',
      headers: {},
      body: { transactionStatus: 'Declined', orderId: order.id }
    });
    assert.equal(getOrder().status, 'pending');
    assert.equal(getSubscription(), null);
    assert.equal(getPaidAt(), null);
    assert.equal(messages.length, 0);
  } finally {
    (global as any).fetch = originalFetch;
  }
});
