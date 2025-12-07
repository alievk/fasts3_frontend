import { D1PaymentStore } from './d1PaymentStore.js';
import { resolveLocale, translate } from './translate.js';
import type { WebhookContext, WebhookHandler } from './webhookTypes.js';

type WataWebhookPayload = {
  transactionStatus?: unknown;
  orderId?: unknown;
  paymentTime?: unknown;
  transactionId?: unknown;
};

const parseOrderId = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const parseDate = (value: unknown): Date | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const addDays = (date: Date, days: number): Date => {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
};

const computeNewExpiresAt = (current: string | null, durationDays: number, now: Date): string => {
  const currentDate = current ? parseDate(current) : null;
  const base = currentDate && currentDate > now ? currentDate : now;
  return addDays(base, durationDays).toISOString();
};

const formatExpiresAt = (iso: string, timezone: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  try {
    return date.toLocaleString('ru-RU', {
      timeZone: timezone,
      dateStyle: 'medium',
      timeStyle: 'short'
    });
  } catch {
    return date.toISOString();
  }
};

const buildMessage = (expiresAt: string, timezone: string, locale: string, isTest: boolean): string => {
  const formatted = formatExpiresAt(expiresAt, timezone);
  const text = translate('subscription.paymentReceived', locale, { date: formatted });
  return isTest ? `[test] ${text}` : text;
};

const isTestRoute = (path: string): boolean => path.includes('wata_test');

const sendTelegramNotification = async (botToken: string, chatId: string, text: string): Promise<void> => {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to send Telegram message: ${errorText || response.statusText}`);
  }
};

const parsePayload = (body: unknown): WataWebhookPayload | null => {
  if (!body || typeof body !== 'object') {
    return null;
  }
  return body as WataWebhookPayload;
};

export const createWataWebhookHandler = (options: {
  store: D1PaymentStore;
  botToken: string;
  timezone: string;
}): WebhookHandler => {
  const { store, botToken, timezone } = options;

  return async ({ path, body, rawBody }: WebhookContext) => {
    if (rawBody) {
      let pretty = rawBody;
      try {
        pretty = JSON.stringify(JSON.parse(rawBody), null, 2);
      } catch {
        // keep raw string
      }
      console.log(`[wata-webhook] raw=\n${pretty}`);
    }
    const payload = parsePayload(body);
    if (!payload || payload.transactionStatus !== 'Paid') {
      return { body: { ok: true } };
    }

    const orderId = parseOrderId(payload.orderId);
    if (orderId === null) {
      return { body: { ok: true } };
    }
    const transactionId = typeof payload.transactionId === 'string' && payload.transactionId ? payload.transactionId : null;

    const order = await store.getOrder(orderId);
    if (!order) {
      return { body: { ok: true } };
    }
    if (order.status === 'paid') {
      return { body: { ok: true } };
    }
    const plan = await store.getPlan(order.planId);
    if (!plan) {
      return { body: { ok: true } };
    }

    const now = new Date();
    const paymentTime = parseDate(payload.paymentTime) ?? now;
    const paidAt = paymentTime.toISOString();
    const currentExpiresAt = await store.getSubscriptionExpiresAt(order.userId);
    const newExpiresAt = computeNewExpiresAt(currentExpiresAt, plan.durationDays, now);
    const isTest = isTestRoute(path);

    if (transactionId && !order.externalId) {
      await store.setOrderExternalId(order.id, transactionId);
    }
    await store.markOrderPaid(order.id, paidAt);
    await store.setSubscriptionExpiresAt(order.userId, newExpiresAt, paidAt);

    const locale = resolveLocale(await store.getChatLocale(order.userId));

    try {
      await sendTelegramNotification(botToken, order.userId, buildMessage(newExpiresAt, timezone, locale, isTest));
    } catch (error) {
      console.error('Failed to send payment notification:', error);
    }

    return { body: { ok: true } };
  };
};
