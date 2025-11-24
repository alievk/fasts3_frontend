import Fastify from 'fastify';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { loadWebhookRoutes, type WebhookRoute } from './webhookRegistry.js';
import type { WebhookContext } from './webhookTypes.js';

const stringifyBody = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable body]';
  }
};

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
      console.log(
        `[payment-webhook] path=${context.path} ip=${context.ip} body=${stringifyBody(context.body)}`
      );
      return reply.send({ ok: true });
    };

  routes.forEach((route) => {
    app.post(route.path, createHandler(route));
  });

  return app;
};

const main = async (): Promise<void> => {
  const routes = await loadWebhookRoutes();
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
