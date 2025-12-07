import crypto from 'node:crypto';
import type { WebhookValidator } from './webhookTypes.js';

type Env = 'prod' | 'test';

type CachedKey = {
  pem: string;
  fetchedAt: number;
};

type PublicKeyResponse = {
  value?: string;
};

const PUBLIC_KEY_URL: Record<Env, string> = {
  prod: 'https://api.wata.pro/api/h2h/public-key',
  test: 'https://api-sandbox.wata.pro/api/h2h/public-key'
};

const CACHE_TTL_MS = 15 * 60 * 1000;

const cache: Partial<Record<Env, CachedKey>> = {};

const fetchPublicKey = async (env: Env): Promise<string> => {
  const response = await fetch(PUBLIC_KEY_URL[env], {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch WATA public key: ${response.status} ${response.statusText}`);
  }
  const json = (await response.json()) as PublicKeyResponse;
  if (!json.value || !json.value.includes('BEGIN PUBLIC KEY')) {
    throw new Error('Invalid WATA public key response');
  }
  return json.value.trim();
};

const getPublicKey = async (env: Env): Promise<string> => {
  const now = Date.now();
  const cached = cache[env];
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.pem;
  }
  try {
    const pem = await fetchPublicKey(env);
    cache[env] = { pem, fetchedAt: now };
    return pem;
  } catch (error) {
    if (cached) {
      console.warn('WATA public key fetch failed, using cached key');
      return cached.pem;
    }
    throw error;
  }
};

const toSignature = (header: unknown): Buffer | null => {
  if (typeof header !== 'string' || !header.trim()) {
    return null;
  }
  try {
    return Buffer.from(header, 'base64');
  } catch {
    return null;
  }
};

const isTestPath = (path: string): boolean => path.includes('wata_test');

const verifySignature = (rawBody: string | undefined, signature: Buffer | null, pem: string): boolean => {
  if (!rawBody || !signature) {
    return false;
  }
  const verifier = crypto.createVerify('sha512');
  verifier.update(rawBody);
  verifier.end();
  try {
    return verifier.verify(pem, signature);
  } catch (error) {
    console.warn('Failed to verify WATA signature', error);
    return false;
  }
};

export const createWataWebhookValidator = async (): Promise<WebhookValidator> => {
  return {
    validate: async ({ headers, rawBody, path }) => {
      const env: Env = isTestPath(path) ? 'test' : 'prod';
      const signatureHeader = headers['x-signature'] ?? headers['X-Signature'];
      const signature = toSignature(signatureHeader);
      const pem = await getPublicKey(env);
      return verifySignature(rawBody, signature, pem);
    }
  };
};
