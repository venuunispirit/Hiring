import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import { query } from '@hi/db';
import { ZodError } from 'zod';
import { loadActor } from './auth';
import { JWT_SECRET, WEB_ORIGIN } from './env';
import { adminRoutes } from './routes/admin';
import { applicationRoutes } from './routes/applications';
import { authRoutes } from './routes/auth';
import { candidateRoutes } from './routes/candidate';
import { companyRoutes } from './routes/company';
import { mentorRoutes } from './routes/mentor';
import { notificationRoutes } from './routes/notifications';
import { profileRoutes } from './routes/profiles';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });

  await app.register(cors, { origin: WEB_ORIGIN, credentials: true });
  await app.register(jwt, { secret: JWT_SECRET });
  await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
  app.decorateRequest('actor', null);

  app.decorate('authenticate', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
    const actor = await loadActor(request.user.sub);
    if (!actor || actor.status !== 'active') {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
    request.actor = actor;
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: 'Validation failed',
        issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const pgError = error as Error & { code?: string; statusCode?: number };
    if (pgError.code === '23505') {
      return reply.code(409).send({ error: 'That record already exists' });
    }
    if (pgError.code === '23503' || pgError.code === '23514') {
      return reply.code(400).send({ error: 'Invalid reference or value' });
    }
    const status = pgError.statusCode ?? 500;
    if (status >= 500) request.log.error(error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return reply
      .code(status)
      .send({ error: status >= 500 ? 'Internal server error' : message });
  });

  app.get('/health', async () => {
    await query('SELECT 1');
    return { ok: true, service: 'hiring-intelligence-api' };
  });

  await app.register(authRoutes, { prefix: '/v1' });
  await app.register(adminRoutes, { prefix: '/v1' });
  await app.register(profileRoutes, { prefix: '/v1' });
  await app.register(applicationRoutes, { prefix: '/v1' });
  await app.register(mentorRoutes, { prefix: '/v1' });
  await app.register(candidateRoutes, { prefix: '/v1' });
  await app.register(companyRoutes, { prefix: '/v1' });
  await app.register(notificationRoutes, { prefix: '/v1' });

  return app;
}
