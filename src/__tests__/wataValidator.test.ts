import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';
import { createWataWebhookValidator } from '../wataValidator.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

const signBody = (body: string): string => {
  const signer = createSign('sha512');
  signer.update(body);
  signer.end();
  return signer.sign(privateKey, 'base64');
};

const makeFetch = (shouldFail = false) =>
  async (): Promise<Response> => {
    if (shouldFail) {
      throw new Error('fetch failed');
    }
    return new Response(JSON.stringify({ value: publicPem }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

test('accepts valid signature', async () => {
  const originalFetch = global.fetch;
  (global as any).fetch = makeFetch();
  try {
    const validator = await createWataWebhookValidator();
    const rawBody = JSON.stringify({ transactionStatus: 'Paid', amount: 100 });
    const signature = signBody(rawBody);
    const ok = await validator.validate({
      path: '/payment/wata',
      ip: '1.2.3.4',
      headers: { 'x-signature': signature },
      rawBody,
      body: {}
    });
    assert.equal(ok, true);
  } finally {
    (global as any).fetch = originalFetch;
  }
});

test('rejects invalid signature', async () => {
  const originalFetch = global.fetch;
  (global as any).fetch = makeFetch();
  try {
    const validator = await createWataWebhookValidator();
    const rawBody = JSON.stringify({ transactionStatus: 'Paid' });
    const badSignature = signBody(`${rawBody}tamper`);
    const ok = await validator.validate({
      path: '/payment/wata',
      ip: '1.2.3.4',
      headers: { 'x-signature': badSignature },
      rawBody,
      body: {}
    });
    assert.equal(ok, false);
  } finally {
    (global as any).fetch = originalFetch;
  }
});

test('uses cached key when fetch fails', async () => {
  const originalFetch = global.fetch;
  const goodFetch = makeFetch();
  (global as any).fetch = goodFetch;
  try {
    const validator = await createWataWebhookValidator();
    const rawBody = JSON.stringify({ transactionStatus: 'Paid' });
    const signature = signBody(rawBody);
    const first = await validator.validate({
      path: '/payment/wata_test',
      ip: '1.2.3.4',
      headers: { 'x-signature': signature },
      rawBody,
      body: {}
    });
    assert.equal(first, true);
    (global as any).fetch = makeFetch(true);
    const second = await validator.validate({
      path: '/payment/wata_test',
      ip: '1.2.3.4',
      headers: { 'x-signature': signature },
      rawBody,
      body: {}
    });
    assert.equal(second, true);
  } finally {
    (global as any).fetch = originalFetch;
  }
});
