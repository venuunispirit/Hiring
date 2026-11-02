import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { one, query, withTransaction } from '@hi/db';
import { applicationSchema, reviewApplicationSchema } from '@hi/shared';
import {
  audit,
  notify,
  requireKyc,
  requirePermission,
  requireRole,
} from '../auth';
import { fail } from '../lib/errors';

type ApplicationRow = {
  id: number;
  user_id: string;
  application_type: 'candidate' | 'mentor';
  status: string;
  resume_id: number | null;
  first_name: string;
  last_name: string;
  email: string;
  extracted_experience: string | null;
};

export async function applicationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/applications/mine', { preHandler: app.authenticate }, async (request) => {
    const actor = request.actor!;
    return query(
      `SELECT a.id, a.application_type, a.status, a.review_notes, a.applied_at, a.reviewed_at,
              jr.title AS job_role, r.file_name
       FROM applications a
       LEFT JOIN job_roles jr ON jr.id = a.job_role_id
       LEFT JOIN resumes r ON r.id = a.resume_id
       WHERE a.user_id = $1
       ORDER BY a.applied_at DESC`,
      [actor.id],
    );
  });

  app.post('/applications', { preHandler: app.authenticate }, async (request, reply) => {
    const actor = request.actor!;
    const body = applicationSchema.parse(request.body);
    requireRole(actor, body.applicationType);
    requireKyc(actor);

    if (body.resumeId) {
      const resume = await one<{ id: number }>(
        'SELECT id FROM resumes WHERE id = $1 AND user_id = $2',
        [body.resumeId, actor.id],
      );
      if (!resume) return fail(400, 'Resume not found');
    }

    const duplicate = await one<{ id: number }>(
      `SELECT id FROM applications
       WHERE user_id = $1 AND application_type = $2 AND status IN ('pending', 'approved')`,
      [actor.id, body.applicationType],
    );
    if (duplicate) return fail(409, 'An active application of this type already exists');

    const application = await withTransaction(async (client) => {
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO applications (user_id, application_type, job_role_id, resume_id)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [actor.id, body.applicationType, body.jobRoleId ?? null, body.resumeId ?? null],
      );
      const id = inserted.rows[0]!.id;
      await client.query(
        `INSERT INTO engagement_events (candidate_id, application_id, event_type)
         VALUES ($1, $2, 'application_submitted')`,
        [actor.id, id],
      );
      await audit(client, actor.id, 'application.submit', 'application', id, {
        type: body.applicationType,
      });
      const admins = await client.query<{ user_id: string }>(
        `SELECT user_id FROM user_roles WHERE role = 'admin' AND is_active`,
      );
      for (const admin of admins.rows) {
        await notify(
          client,
          admin.user_id,
          `${actor.firstName} ${actor.lastName} applied as ${body.applicationType}.`,
          'application',
        );
      }
      return id;
    });

    return reply.code(201).send({ id: application });
  });

  app.get('/applications', { preHandler: app.authenticate }, async (request) => {
    requirePermission(request.actor!, 'applications.view');
    const { status, type } = request.query as { status?: string; type?: string };
    return query(
      `SELECT a.id, a.application_type, a.status, a.review_notes, a.applied_at, a.reviewed_at,
              u.id AS user_id, u.first_name, u.last_name, u.email,
              jr.title AS job_role, r.file_name, r.extracted_experience,
              r.analysis_status
       FROM applications a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN job_roles jr ON jr.id = a.job_role_id
       LEFT JOIN resumes r ON r.id = a.resume_id
       WHERE ($1::text IS NULL OR a.status = $1)
         AND ($2::text IS NULL OR a.application_type = $2)
       ORDER BY a.applied_at DESC
       LIMIT 200`,
      [status ?? null, type ?? null],
    );
  });

  app.post('/applications/:id/review', { preHandler: app.authenticate }, async (request) => {
    const actor = request.actor!;
    requirePermission(actor, 'applications.review');
    const applicationId = Number((request.params as { id: string }).id);
    const body = reviewApplicationSchema.parse(request.body);

    const result = await withTransaction(async (client) => {
      const found = await client.query<ApplicationRow>(
        `SELECT a.id, a.user_id, a.application_type, a.status, a.resume_id,
                u.first_name, u.last_name, u.email, r.extracted_experience
         FROM applications a
         JOIN users u ON u.id = a.user_id
         LEFT JOIN resumes r ON r.id = a.resume_id
         WHERE a.id = $1
         FOR UPDATE OF a`,
        [applicationId],
      );
      const application = found.rows[0];
      if (!application) fail(404, 'Application not found');
      if (application.status !== 'pending') fail(409, 'Application was already reviewed');

      const experience =
        body.extractedExperience ??
        (application.extracted_experience === null
          ? null
          : Number(application.extracted_experience));
      const targetType = body.routeTo ?? application.application_type;

      if (body.status === 'approved' && targetType === 'mentor') {
        const setting = await client.query<{ value: number }>(
          `SELECT value FROM platform_settings WHERE key = 'mentor_experience_threshold'`,
        );
        const threshold = Number(setting.rows[0]?.value ?? 10);
        if ((experience ?? 0) < threshold && !body.force) {
          fail(
            400,
            `Mentor applications need ${threshold}+ years of experience. Set force=true to override (logged).`,
          );
        }
      }

      await client.query(
        `UPDATE applications
         SET status = $1, reviewed_by = $2, reviewed_at = now(), review_notes = $3,
             application_type = CASE WHEN $1 = 'approved' THEN $5 ELSE application_type END
         WHERE id = $4`,
        [body.status, actor.id, body.reviewNotes ?? null, applicationId, targetType],
      );

      if (body.extractedExperience != null && application.resume_id) {
        await client.query(
          `UPDATE resumes SET extracted_experience = $1, analysis_status = 'parsed'
           WHERE id = $2`,
          [body.extractedExperience, application.resume_id],
        );
      }

      if (body.status === 'approved') {
        if (targetType === 'candidate' && application.application_type === 'mentor') {
          await client.query(
            `UPDATE user_roles SET is_active = false
             WHERE user_id = $1 AND role = 'mentor'`,
            [application.user_id],
          );
        }
        await client.query(
          `INSERT INTO user_roles (user_id, role, is_active, assigned_by)
           VALUES ($1, $2, true, $3)
           ON CONFLICT (user_id, role) DO UPDATE SET is_active = true`,
          [application.user_id, targetType, actor.id],
        );
      }

      await notify(
        client,
        application.user_id,
        `Your ${targetType} application was ${body.status}.`,
        'application',
      );
      await audit(client, actor.id, 'applications.review', 'application', applicationId, {
        status: body.status,
        force: body.force,
        experience,
        routedTo: targetType,
      });

      if (body.status === 'approved' && targetType === 'candidate' && body.mentorId) {
        await assignMentor(client, applicationId, body.mentorId, actor.id);
      }

      return { id: applicationId, status: body.status, routedTo: targetType, experience };
    });

    return result;
  });

  app.post('/applications/:id/assign-mentor', { preHandler: app.authenticate }, async (request) => {
    const actor = request.actor!;
    requirePermission(actor, 'mentors.assign');
    const applicationId = Number((request.params as { id: string }).id);
    const { mentorId } = (request.body ?? {}) as { mentorId?: string };
    if (!mentorId) return fail(400, 'mentorId is required');

    return withTransaction(async (client) => {
      const assignmentId = await assignMentor(client, applicationId, mentorId, actor.id);
      await audit(client, actor.id, 'mentor.assign', 'mentor_assignment', assignmentId, {
        applicationId,
        mentorId,
      });
      return { id: assignmentId };
    });
  });
}

async function assignMentor(
  client: pg.PoolClient,
  applicationId: number,
  mentorId: string,
  actorId: string,
): Promise<number> {
  const application = await client.query<{ id: number; user_id: string; status: string; application_type: string }>(
    'SELECT id, user_id, status, application_type FROM applications WHERE id = $1',
    [applicationId],
  );
  const row = application.rows[0];
  if (!row) fail(404, 'Application not found');
  if (row.status !== 'approved' || row.application_type !== 'candidate') {
    fail(400, 'Mentors can only be assigned to approved candidate applications');
  }

  const mentor = await client.query<{ user_id: string }>(
    `SELECT ur.user_id FROM user_roles ur
     WHERE ur.user_id = $1 AND ur.role = 'mentor' AND ur.is_active
       AND EXISTS (SELECT 1 FROM applications a
                   WHERE a.user_id = ur.user_id AND a.application_type = 'mentor' AND a.status = 'approved')`,
    [mentorId],
  );
  if (!mentor.rowCount) fail(400, 'Mentor is not active or approved');

  const existing = await client.query<{ id: number }>(
    `SELECT id FROM mentor_assignments
     WHERE application_id = $1 AND status = 'active'`,
    [applicationId],
  );
  if (existing.rowCount) fail(409, 'An active mentor is already assigned');

  const inserted = await client.query<{ id: number }>(
    `INSERT INTO mentor_assignments (application_id, mentor_id, assigned_by)
     VALUES ($1, $2, $3) RETURNING id`,
    [applicationId, mentorId, actorId],
  );
  const assignmentId = inserted.rows[0]!.id;
  await notify(client, mentorId, 'A new candidate was assigned to you.', 'mentor');
  await notify(client, row.user_id, 'A mentor was assigned to your application.', 'mentor');
  await client.query(
    `INSERT INTO engagement_events (candidate_id, application_id, event_type)
     VALUES ($1, $2, 'mentor_assigned')`,
    [row.user_id, applicationId],
  );
  return assignmentId;
}
