import type { FastifyInstance } from 'fastify';
import { one, query, withTransaction } from '@hi/db';
import {
  FREE_EMAIL_DOMAINS,
  hashPassword,
  kycSchema,
  loginSchema,
  registerSchema,
  verifyPassword,
} from '@hi/shared';
import { audit, loadActor, requireKyc, requireRole } from '../auth';
import { fail } from '../lib/errors';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/register', async (request, reply) => {
    const body = registerSchema.parse(request.body);
    const domain = body.email.split('@')[1] ?? '';
    if (body.role === 'company' && FREE_EMAIL_DOMAINS.has(domain)) {
      return fail(400, 'Use a business email address for company accounts');
    }

    const user = await withTransaction(async (client) => {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO users (first_name, last_name, email, password_hash, phone)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [body.firstName, body.lastName, body.email, hashPassword(body.password), body.phone ?? null],
      );
      const userId = inserted.rows[0]!.id;
      await client.query('INSERT INTO user_roles (user_id, role) VALUES ($1, $2)', [
        userId,
        body.role,
      ]);

      if (body.role === 'candidate' || body.role === 'mentor') {
        await client.query('INSERT INTO profiles (user_id) VALUES ($1)', [userId]);
      }

      if (body.role === 'company') {
        const company = await client.query<{ id: number }>(
          `INSERT INTO companies (company_name, status) VALUES ($1, 'active') RETURNING id`,
          [body.companyName!],
        );
        await client.query('INSERT INTO company_members (company_id, user_id) VALUES ($1, $2)', [
          company.rows[0]!.id,
          userId,
        ]);
      }

      await audit(client, userId, 'auth.register', 'user', userId, { role: body.role });
      return userId;
    });

    const actor = await loadActor(user);
    const token = app.jwt.sign({ sub: user }, { expiresIn: '7d' });
    return reply.code(201).send({ token, user: actor });
  });

  app.post('/auth/login', async (request) => {
    const body = loginSchema.parse(request.body);
    const row = await one<{
      id: string;
      password_hash: string;
      status: string;
    }>('SELECT id, password_hash, status FROM users WHERE email = $1', [body.email]);

    if (!row || !verifyPassword(body.password, row.password_hash)) {
      return fail(401, 'Invalid email or password');
    }
    if (row.status !== 'active') return fail(403, 'Account is not active');

    const actor = await loadActor(row.id);
    if (!actor) return fail(401, 'Invalid email or password');
    const company = actor.roles.find((role) => role.role === 'company' && role.isActive);
    const domain = body.email.split('@')[1] ?? '';
    if (company && FREE_EMAIL_DOMAINS.has(domain)) {
      return fail(403, 'Company accounts require a verified business email address');
    }
    const token = app.jwt.sign({ sub: row.id }, { expiresIn: '7d' });
    return { token, user: actor };
  });

  app.get('/auth/me', { preHandler: app.authenticate }, async (request) => request.actor);

  app.post('/auth/kyc', { preHandler: app.authenticate }, async (request) => {
    const actor = request.actor!;
    requireRole(actor, 'candidate', 'mentor');
    const body = kycSchema.parse(request.body);

    // Sandbox provider. Swap the adapter for DigiLocker/eKYC; only the
    // provider reference and consent timestamp are stored, never an Aadhaar number.
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO identity_verifications
           (user_id, provider, provider_ref, status, consent_given_at, verified_at)
         VALUES ($1, $2, $3, 'verified', now(), now())`,
        [actor.id, body.provider, body.providerRef],
      );
      await audit(client, actor.id, 'identity.verify', 'user', actor.id, { provider: body.provider });
    });

    if (!actor.kycVerified) requireKyc(actor);
    return loadActor(actor.id);
  });
}
