import Fastify from 'fastify';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { D1PaymentStore } from './d1PaymentStore.js';
import { loadConfig } from './config.js';
import { createYookassaWebhookHandler } from './yookassaWebhookHandler.js';
import { createWataWebhookHandler } from './wataWebhookHandler.js';
import { loadWebhookRoutes, type WebhookRoute } from './webhookRegistry.js';
import type { WebhookContext } from './webhookTypes.js';

const formatTimestamp = (timezone: string): string => {
  const now = new Date();
  try {
    const formatted = now
      .toLocaleString('ru-RU', { timeZone: timezone, hour12: false })
      .replace(',', '');
    return `[${formatted}]`;
  } catch {
    return `[${now.toISOString()}]`;
  }
};

const createServer = (routes: WebhookRoute[], timezone: string): FastifyInstance => {
  const app = Fastify({ trustProxy: true, logger: false });

  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    const text = typeof body === 'string' ? body : body?.toString() ?? '';
    (request as FastifyRequest & { rawBody?: string }).rawBody = text;
    try {
      const parsed = text ? JSON.parse(text) : null;
      done(null, parsed);
    } catch (error) {
      done(error as Error);
    }
  });

  const buildContext = (request: FastifyRequest<{ Body: unknown }>): WebhookContext => ({
    ip: request.ip,
    path: request.url,
    body: request.body,
    headers: request.headers as Record<string, unknown>,
    rawBody: (request as FastifyRequest & { rawBody?: string }).rawBody
  });

  const createHandler = (route: WebhookRoute) =>
    async (request: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
      const context = buildContext(request);
      const allowed = await route.validator.validate(context);
      if (!allowed) {
        return reply.status(403).send({ error: 'forbidden' });
      }
      const payload = context.body && typeof context.body === 'object' ? (context.body as Record<string, unknown>) : null;
      let event = 'unknown';
      let objectId = 'unknown';
      let status = 'unknown';
      let internalOrderId: unknown;

      if (payload?.event) {
        event = String(payload.event);
      }
      const nested = payload && typeof payload.object === 'object' && payload.object !== null ? (payload.object as Record<string, unknown>) : null;
      if (nested?.id) {
        objectId = String(nested.id);
      }
      if (nested?.status) {
        status = String(nested.status);
      }
      const metadata = nested && typeof nested.metadata === 'object' && nested.metadata !== null ? (nested.metadata as Record<string, unknown>) : null;
      if (metadata && 'internal_order_id' in metadata) {
        internalOrderId = (metadata as Record<string, unknown>).internal_order_id;
      }

      // WATA payloads
      if (payload?.transactionStatus || payload?.orderId) {
        event = String(payload.transactionStatus ?? event);
        status = String(payload.transactionStatus ?? status);
        internalOrderId = payload.orderId ?? internalOrderId;
        if (payload.transactionId) {
          objectId = String(payload.transactionId);
        } else if (payload.id) {
          objectId = String(payload.id);
        }
      }
      const ts = formatTimestamp(timezone);
      console.log(
        `[payment-webhook] ${ts} path=${context.path} ip=${context.ip} event=${event} payment_id=${objectId} status=${status} internal_order_id=${internalOrderId}`
      );
      try {
        const result = route.handler ? await route.handler(context) : undefined;
        if (result?.status) {
          reply.status(result.status);
        }
        return reply.send(result?.body ?? { ok: true });
      } catch (error) {
        console.error('Webhook handler failed:', error);
        return reply.status(500).send({ error: 'internal_error' });
      }
    };

  routes.forEach((route) => {
    app.post(route.path, createHandler(route));
  });

  return app;
};

const main = async (): Promise<void> => {
  const config = loadConfig();
  if (!config.d1AccountId || !config.d1DatabaseId || !config.d1ApiToken) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID, and CLOUDFLARE_API_TOKEN are required');
  }
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    throw new Error('TELEGRAM_BOT_TOKEN is required');
  }
  const store = new D1PaymentStore(config.d1AccountId, config.d1DatabaseId, config.d1ApiToken);
  const yookassaHandler = createYookassaWebhookHandler({
    store,
    botToken,
    timezone: config.timezone
  });
  const wataHandler = createWataWebhookHandler({
    store,
    botToken,
    timezone: config.timezone
  });
  const routes = await loadWebhookRoutes({ yookassa: yookassaHandler, wata: wataHandler });
  const server = createServer(routes, config.timezone);
  const port = Number(process.env.PORT || '8040');
  const host = '0.0.0.0';
  await server.listen({ port, host });
  console.log(`Payment webhook server listening on http://${host}:${port}`);
};

void main().catch((error) => {
  console.error('Failed to start payment webhook server:', error);
  process.exit(1);
});
