import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WataClient } from '../wataClient.js';

const stubFetch =
  (status: number, body: unknown, onCall?: (init?: RequestInit) => void) =>
  async (_url: string, init?: RequestInit): Promise<Response> => {
    onCall?.(init);
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });
  };

test('creates WATA link with required fields', async () => {
  const calls: RequestInit[] = [];
  const originalFetch = global.fetch;
  (global as any).fetch = stubFetch(200, { id: 'link-1', url: 'https://pay/link-1' }, (init) => {
    if (init) {
      calls.push(init);
    }
  });
  try {
    const client = new WataClient('access-token', 'https://api.wata.pro/api/h2h');
    const link = await client.createPayment({
      amount: 150,
      description: 'Plan #1',
      returnUrl: 'https://t.me/test_bot',
      internalOrderId: 10
    });
    assert.equal(link.id, 'link-1');
    assert.equal(link.confirmationUrl, 'https://pay/link-1');
    const request = calls[0];
    assert.ok(request, 'expected fetch call');
    const headers = request.headers as Record<string, string>;
    assert.equal(headers.Authorization, 'Bearer access-token');
    assert.equal(headers['Content-Type'], 'application/json');
    const payload = JSON.parse((request.body as string) ?? '{}');
    assert.equal(payload.amount, 150);
    assert.equal(payload.currency, 'RUB');
    assert.equal(payload.description, 'Plan #1');
    assert.equal(payload.orderId, '10');
    assert.equal(payload.successRedirectUrl, 'https://t.me/test_bot');
    assert.equal(payload.failRedirectUrl, 'https://t.me/test_bot');
  } finally {
    (global as any).fetch = originalFetch;
  }
});

test('extracts nested link fields', async () => {
  const originalFetch = global.fetch;
  (global as any).fetch = stubFetch(200, {
    data: { linkId: 'nested-id', redirectUrl: 'https://pay/nested' }
  });
  try {
    const client = new WataClient('token', 'https://api.wata.pro/api/h2h');
    const link = await client.createPayment({
      amount: 50,
      description: 'Nested',
      returnUrl: 'https://t.me/test_bot',
      internalOrderId: 1
    });
    assert.equal(link.id, 'nested-id');
    assert.equal(link.confirmationUrl, 'https://pay/nested');
  } finally {
    (global as any).fetch = originalFetch;
  }
});

test('throws when response misses link data', async () => {
  const originalFetch = global.fetch;
  (global as any).fetch = stubFetch(200, { ok: true });
  try {
    const client = new WataClient('token', 'https://api.wata.pro/api/h2h');
    await assert.rejects(
      client.createPayment({
        amount: 10,
        description: 'bad',
        returnUrl: 'https://t.me/test_bot',
        internalOrderId: 2
      }),
      /WATA response is missing link id or url/
    );
  } finally {
    (global as any).fetch = originalFetch;
  }
});
