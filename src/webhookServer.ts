import Fastify from 'fastify';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { D1PaymentStore } from './d1PaymentStore.js';
import { loadConfig } from './config.js';
import { createYookassaWebhookHandler } from './yookassaWebhookHandler.js';
import { loadWebhookRoutes, type WebhookRoute } from './webhookRegistry.js';
import type { WebhookContext } from './webhookTypes.js';

const createServer = (routes: WebhookRoute[]): FastifyInstance => {
  const app = Fastify({ trustProxy: true, logger: false });

  const buildContext = (request: FastifyRequest<{ Body: unknown }>): WebhookContext => ({
    ip: request.ip,
    path: request.url,
    body: request.body,
    headers: request.headers as Record<string, unknown>
  });

  const createHandler = (route: WebhookRoute) =>
    async (request: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
      const context = buildContext(request);
      const allowed = await route.validator.validate(context);
      if (!allowed) {
        return reply.status(403).send({ error: 'forbidden' });
      }
      const brief =
        context.body && typeof context.body === 'object'
          ? (context.body as { event?: unknown; object?: { id?: unknown; status?: unknown; metadata?: unknown } })
          : null;
      const event = brief?.event ? String(brief.event) : 'unknown';
      const objectId = brief?.object?.id ? String(brief.object.id) : 'unknown';
      const status = brief?.object?.status ? String(brief.object.status) : 'unknown';
      const metadata = brief?.object?.metadata;
      const internalOrderId =
        metadata && typeof metadata === 'object' && metadata !== null && 'internal_order_id' in metadata
          ? (metadata as Record<string, unknown>).internal_order_id
          : undefined;
      console.log(
        `[payment-webhook] path=${context.path} ip=${context.ip} event=${event} payment_id=${objectId} status=${status} internal_order_id=${internalOrderId}`
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
  const routes = await loadWebhookRoutes(yookassaHandler);
  const server = createServer(routes);
  const port = Number(process.env.PORT || '8040');
  const host = '0.0.0.0';
  await server.listen({ port, host });
  console.log(`Payment webhook server listening on http://${host}:${port}`);
};

void main().catch((error) => {
  console.error('Failed to start payment webhook server:', error);
  process.exit(1);
});
