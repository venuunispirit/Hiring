import type { FastifyInstance } from 'fastify';
import { one, query, withTransaction } from '@hi/db';
import { introductionRequestSchema, searchQuerySchema } from '@hi/shared';
import { audit, notify, requirePermission, requireRole } from '../auth';
import { fail } from '../lib/errors';

export async function companyRoutes(app: FastifyInstance): Promise<void> {
  app.get('/company/me', { preHandler: app.authenticate }, async (request) => {
    const actor = request.actor!;
    requireRole(actor, 'company');
    if (!actor.companyId) return fail(403, 'No company membership');
    return one(
      `SELECT c.id, c.company_name, c.website, c.industry, c.status,
              (SELECT count(*) FROM company_members cm WHERE cm.company_id = c.id) AS members
       FROM companies c WHERE c.id = $1`,
      [actor.companyId],
    );
  });

  // Restricted view only: no names, contact data, resume links or answers.
  app.get('/company/search', { preHandler: app.authenticate }, async (request) => {
    const actor = request.actor!;
    requireRole(actor, 'company');
    requirePermission(actor, 'candidates.search');
    const filters = searchQuerySchema.parse(request.query);

    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filters.q) {
      params.push(`%${filters.q}%`);
      clauses.push(`(professional_title ILIKE $${params.length} OR location ILIKE $${params.length})`);
    }
    if (filters.role) {
      params.push(`%${filters.role}%`);
      clauses.push(
        `EXISTS (SELECT 1 FROM unnest(job_roles) r WHERE r ILIKE $${params.length})`,
      );
    }
    if (filters.skill) {
      params.push(filters.skill);
      clauses.push(
        `EXISTS (SELECT 1 FROM unnest(skills) s WHERE lower(s) = lower($${params.length}))`,
      );
    }
    if (filters.minExperience !== undefined) {
      params.push(filters.minExperience);
      clauses.push(`COALESCE(total_experience_years, 0) >= $${params.length}`);
    }
    if (filters.minScore !== undefined) {
      params.push(filters.minScore);
      clauses.push(`COALESCE(latest_score, 0) >= $${params.length}`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(filters.limit, filters.offset);

    return query(
      `SELECT *, count(*) OVER() AS total
       FROM company_candidate_search
       ${where}
       ORDER BY latest_score DESC NULLS LAST, total_experience_years DESC NULLS LAST
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
  });

  app.get('/company/search/:ref', { preHandler: app.authenticate }, async (request) => {
    const actor = request.actor!;
    requireRole(actor, 'company');
    requirePermission(actor, 'candidates.search');
    const ref = (request.params as { ref: string }).ref;
    if (!/^[0-9a-f-]{36}$/i.test(ref)) return fail(400, 'Invalid candidate reference');

    const row = await one(
      'SELECT * FROM company_candidate_search WHERE candidate_ref = $1',
      [ref],
    );
    if (!row) return fail(404, 'Candidate not found');
    return row;
  });

  app.post('/company/introductions', { preHandler: app.authenticate }, async (request, reply) => {
    const actor = request.actor!;
    requireRole(actor, 'company');
    requirePermission(actor, 'introductions.request');
    if (!actor.companyId) return fail(403, 'No company membership');
    const body = introductionRequestSchema.parse(request.body);

    const candidate = await one<{ user_id: string }>(
      `SELECT p.user_id FROM profiles p
       WHERE p.public_ref = $1
         AND EXISTS (SELECT 1 FROM company_candidate_search v WHERE v.candidate_ref = p.public_ref)`,
      [body.candidateRef],
    );
    if (!candidate) return fail(404, 'Candidate not found');

    const id = await withTransaction(async (client) => {
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO introduction_requests (company_id, candidate_id, requested_by, message)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [actor.companyId, candidate.user_id, actor.id, body.message],
      );
      const requestId = inserted.rows[0]!.id;
      await notify(
        client,
        candidate.user_id,
        'A company requested an introduction. Review it in your dashboard.',
        'introduction',
      );
      await audit(client, actor.id, 'introduction.request', 'introduction_request', requestId, {
        companyId: actor.companyId,
      });
      return requestId;
    });

    return reply.code(201).send({ id });
  });

  app.get('/company/introductions', { preHandler: app.authenticate }, async (request) => {
    const actor = request.actor!;
    requireRole(actor, 'company');
    if (!actor.companyId) return fail(403, 'No company membership');

    return query(
      `SELECT ir.id, ir.message, ir.status, ir.requested_at, ir.responded_at,
              p.public_ref AS candidate_ref, p.professional_title, p.location,
              p.total_experience_years,
              CASE WHEN ir.status = 'accepted' THEN u.first_name END AS candidate_first_name,
              CASE WHEN ir.status = 'accepted' THEN u.last_name END AS candidate_last_name,
              CASE WHEN ir.status = 'accepted' THEN u.email END AS candidate_email,
              CASE WHEN ir.status = 'accepted' THEN u.phone END AS candidate_phone
       FROM introduction_requests ir
       JOIN profiles p ON p.user_id = ir.candidate_id
       JOIN users u ON u.id = ir.candidate_id
       WHERE ir.company_id = $1
       ORDER BY ir.requested_at DESC`,
      [actor.companyId],
    );
  });

  app.post(
    '/company/introductions/:id/withdraw',
    { preHandler: app.authenticate },
    async (request) => {
      const actor = request.actor!;
      requireRole(actor, 'company');
      requirePermission(actor, 'introductions.request');
      const id = Number((request.params as { id: string }).id);

      const result = await query(
        `UPDATE introduction_requests SET status = 'withdrawn', responded_at = now()
         WHERE id = $1 AND company_id = $2 AND status = 'pending'
         RETURNING id`,
        [id, actor.companyId],
      );
      if (!result.length) return fail(409, 'Only a pending request can be withdrawn');
      return { ok: true };
    },
  );
}
