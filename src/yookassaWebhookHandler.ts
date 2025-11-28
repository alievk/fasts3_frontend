import { D1PaymentStore } from './d1PaymentStore.js';
import type { PaymentOrder } from './types.js';
import type { WebhookContext, WebhookHandler } from './webhookTypes.js';
import { translate, resolveLocale } from './translate.js';

type YookassaMetadata = {
  internal_order_id?: unknown;
};

type YookassaObject = {
  metadata?: YookassaMetadata;
};

type YookassaPayload = {
  event?: string;
  object?: YookassaObject;
};

const parseInternalOrderId = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const parsePayload = (body: unknown): YookassaPayload | null => {
  if (!body || typeof body !== 'object') {
    return null;
  }
  return body as YookassaPayload;
};

const parseDate = (value: string | null): Date | null => {
  if (!value) {
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
  const currentDate = parseDate(current);
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

const isTestRoute = (path: string): boolean => path.includes('yookassa_test');

export const createYookassaWebhookHandler = (options: {
  store: D1PaymentStore;
  botToken: string;
  timezone: string;
}): WebhookHandler => {
  const { store, botToken, timezone } = options;

  return async ({ path, body }: WebhookContext) => {
    const payload = parsePayload(body);
    if (!payload || payload.event !== 'payment.succeeded') {
      return { body: { ok: true } };
    }
    const orderId = parseInternalOrderId(payload.object?.metadata?.internal_order_id);
    if (orderId === null) {
      return { body: { ok: true } };
    }
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
    const paidAt = now.toISOString();
    const currentExpiresAt = await store.getSubscriptionExpiresAt(order.userId);
    const newExpiresAt = computeNewExpiresAt(currentExpiresAt, plan.durationDays, now);
    const isTest = isTestRoute(path);

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
