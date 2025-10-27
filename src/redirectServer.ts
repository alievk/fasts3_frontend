#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import Fastify from 'fastify';
import { loadConfig } from './config.js';
import { RedirectRegistry } from './redirectRegistry.js';

export const createRedirectServer = () => {
  const config = loadConfig();
  const registry = new RedirectRegistry(config.redirectDbPath);
  registry.start();

  const app = Fastify({
    logger: false
  });

  app.addHook('onClose', async () => {
    registry.close();
  });

  app.get('/health', async () => ({
    status: 'ok',
    registrySize: registry.listActive().length
  }));

  app.get('/admin/presigned', async () => registry.listActive());

  app.post<{
    Body: {
      jobId?: string;
      url?: string;
      expiresIn?: number;
      expiresAt?: string;
    };
  }>('/admin/presigned', async (request, reply) => {
    const { jobId, url, expiresIn, expiresAt } = request.body ?? {};
    if (!jobId || !url) {
      return reply.status(400).send({
        error: 'invalid_request',
        message: '`jobId` and `url` are required.'
      });
    }

    let targetExpiry: Date | undefined;
    if (expiresAt) {
      const parsed = new Date(expiresAt);
      if (Number.isNaN(parsed.getTime())) {
        return reply.status(400).send({
          error: 'invalid_request',
          message: '`expiresAt` must be a valid ISO timestamp.'
        });
      }
      targetExpiry = parsed;
    } else if (expiresIn !== undefined) {
      if (typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 0) {
        return reply.status(400).send({
          error: 'invalid_request',
          message: '`expiresIn` must be a positive number of seconds.'
        });
      }
      targetExpiry = new Date(Date.now() + expiresIn * 1000);
    } else {
      return reply.status(400).send({
        error: 'invalid_request',
        message: 'Provide either `expiresIn` (seconds) or `expiresAt` (ISO timestamp).'
      });
    }

    registry.register({
      jobId,
      url,
      expiresAt: targetExpiry
    });

    return reply.status(201).send({
      jobId,
      url,
      expiresAt: targetExpiry.toISOString()
    });
  });

  app.delete<{
    Params: { jobId: string };
  }>('/admin/presigned/:jobId', async (request, reply) => {
    const { jobId } = request.params;
    const removed = registry.remove(jobId);
    if (!removed) {
      return reply.status(404).send({
        error: 'not_found',
        message: 'Entry not found.'
      });
    }
    return reply.status(204).send();
  });

  app.get<{
    Params: { jobId: string };
  }>('/presigned/:jobId/info', async (request, reply) => {
    const { jobId } = request.params;
    const record = registry.getRecord(jobId);

    if (!record) {
      return reply.status(404).send({
        status: 'missing',
        error: 'not_found',
        message: 'No shortcut registered for this job.'
      });
    }

    const expiresAtIso = new Date(record.expiresAtMs).toISOString();
    const createdAtIso = new Date(record.createdAtMs).toISOString();

    if (record.expiresAtMs <= Date.now()) {
      return reply.status(410).send({
        status: 'expired',
        jobId: record.jobId,
        expiresAt: expiresAtIso,
        createdAt: createdAtIso,
        message: 'Presigned link expired.'
      });
    }

    return reply.send({
      status: 'ready',
      jobId: record.jobId,
      url: record.url,
      expiresAt: expiresAtIso,
      createdAt: createdAtIso
    });
  });

  app.get<{
    Params: { jobId: string };
  }>('/presigned/:jobId', async (request, reply) => {
    const { jobId } = request.params;
    const record = registry.getRecord(jobId);

    if (!record) {
      return reply.status(404).send({
        error: 'not_found',
        message: 'Shortcut not registered.'
      });
    }

    if (record.expiresAtMs <= Date.now()) {
      return reply.status(410).send({
        error: 'expired',
        message: 'Presigned link expired.',
        expiresAt: new Date(record.expiresAtMs).toISOString()
      });
    }

    reply.redirect(record.url, 302);
    return reply;
  });

  return {
    app,
    registry,
    config
  };
};

export const startRedirectServer = async (): Promise<void> => {
  const { app, config } = createRedirectServer();
  try {
    await app.listen({
      host: config.redirectServerHost,
      port: config.redirectServerPort
    });
  } catch (error) {
    await app.close();
    throw error;
  }
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startRedirectServer().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
