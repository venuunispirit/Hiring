import { createWriteStream } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import { one, query, withTransaction } from '@hi/db';
import { profileSchema } from '@hi/shared';
import { audit, requireRole } from '../auth';
import { UPLOAD_DIR } from '../env';
import { fail } from '../lib/errors';

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.txt']);

export async function profileRoutes(app: FastifyInstance): Promise<void> {
  app.get('/candidate/profile', { preHandler: app.authenticate }, async (request) => {
    const actor = request.actor!;
    requireRole(actor, 'candidate', 'mentor');

    const [profile, skills, resumes, applications] = await Promise.all([
      one(
        `SELECT user_id, public_ref, professional_title, total_experience_years, location,
                education, bio, availability, is_discoverable
         FROM profiles WHERE user_id = $1`,
        [actor.id],
      ),
      query(
        `SELECT s.id, s.skill_name, us.experience_years, us.proficiency
         FROM user_skills us JOIN skills s ON s.id = us.skill_id
         WHERE us.user_id = $1 ORDER BY s.skill_name`,
        [actor.id],
      ),
      query(
        `SELECT id, file_name, is_primary, uploaded_at, extracted_experience, analysis_status
         FROM resumes WHERE user_id = $1 ORDER BY uploaded_at DESC`,
        [actor.id],
      ),
      query(
        `SELECT a.id, a.application_type, a.status, a.applied_at, a.review_notes,
                jr.title AS job_role
         FROM applications a
         LEFT JOIN job_roles jr ON jr.id = a.job_role_id
         WHERE a.user_id = $1 ORDER BY a.applied_at DESC`,
        [actor.id],
      ),
    ]);

    return { profile, skills, resumes, applications, kycVerified: actor.kycVerified };
  });

  app.put('/candidate/profile', { preHandler: app.authenticate }, async (request) => {
    const actor = request.actor!;
    requireRole(actor, 'candidate', 'mentor');
    const body = profileSchema.parse(request.body);

    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO profiles
           (user_id, professional_title, total_experience_years, location, education, bio,
            availability, is_discoverable)
         VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, false))
         ON CONFLICT (user_id) DO UPDATE SET
           professional_title = EXCLUDED.professional_title,
           total_experience_years = EXCLUDED.total_experience_years,
           location = EXCLUDED.location,
           education = EXCLUDED.education,
           bio = EXCLUDED.bio,
           availability = EXCLUDED.availability,
           is_discoverable = COALESCE($8, profiles.is_discoverable)`,
        [
          actor.id,
          body.professionalTitle ?? null,
          body.totalExperienceYears ?? null,
          body.location ?? null,
          body.education ?? null,
          body.bio ?? null,
          body.availability ?? null,
          body.isDiscoverable ?? null,
        ],
      );

      if (body.skills) {
        for (const skill of body.skills) {
          const created = await client.query<{ id: number }>(
            `INSERT INTO skills (skill_name) VALUES ($1)
             ON CONFLICT (skill_name) DO UPDATE SET skill_name = EXCLUDED.skill_name
             RETURNING id`,
            [skill.skillName],
          );
          await client.query(
            `INSERT INTO user_skills (user_id, skill_id, experience_years, proficiency)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id, skill_id) DO UPDATE SET
               experience_years = EXCLUDED.experience_years,
               proficiency = EXCLUDED.proficiency`,
            [actor.id, created.rows[0]!.id, skill.experienceYears ?? null, skill.proficiency ?? null],
          );
        }
        const keep = body.skills.map((s) => s.skillName.toLowerCase());
        await client.query(
          `DELETE FROM user_skills us
           USING skills s
           WHERE us.skill_id = s.id AND us.user_id = $1
             AND NOT (lower(s.skill_name) = ANY($2::text[]))`,
          [actor.id, keep],
        );
      }

      if (body.isDiscoverable !== undefined) {
        await client.query(
          `INSERT INTO engagement_events (candidate_id, event_type)
           VALUES ($1, 'profile_updated')`,
          [actor.id],
        );
      }
      await audit(client, actor.id, 'profile.update', 'profile', actor.id, {});
    });

    return { ok: true };
  });

  app.get('/candidate/resumes', { preHandler: app.authenticate }, async (request) => {
    const actor = request.actor!;
    requireRole(actor, 'candidate', 'mentor');
    return query(
      `SELECT id, file_name, is_primary, uploaded_at, extracted_experience, analysis_status
       FROM resumes WHERE user_id = $1 ORDER BY uploaded_at DESC`,
      [actor.id],
    );
  });

  app.post('/candidate/resumes', { preHandler: app.authenticate }, async (request, reply) => {
    const actor = request.actor!;
    requireRole(actor, 'candidate', 'mentor');

    const upload = await request.file();
    if (!upload) return fail(400, 'No file uploaded');
    const extension = path.extname(upload.filename).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      return fail(400, 'Upload a PDF, DOC, DOCX or TXT file');
    }

    await mkdir(UPLOAD_DIR, { recursive: true });
    const storedName = `${randomUUID()}${extension}`;
    await pipeline(upload.file, createWriteStream(path.join(UPLOAD_DIR, storedName)));

    const resume = await withTransaction(async (client) => {
      const count = await client.query<{ count: string }>(
        'SELECT count(*) FROM resumes WHERE user_id = $1',
        [actor.id],
      );
      const isPrimary = count.rows[0]!.count === '0';
      if (isPrimary) {
        await client.query('UPDATE resumes SET is_primary = false WHERE user_id = $1', [actor.id]);
      }
      const inserted = await client.query(
        `INSERT INTO resumes (user_id, file_url, file_name, is_primary, analysis_status)
         VALUES ($1, $2, $3, $4, 'needs_review')
         RETURNING id, file_name, is_primary, uploaded_at, analysis_status`,
        [actor.id, storedName, upload.filename, isPrimary],
      );
      await audit(client, actor.id, 'resume.upload', 'resume', inserted.rows[0]!.id, {
        fileName: upload.filename,
      });
      return inserted.rows[0];
    });

    return reply.code(201).send(resume);
  });

  app.get('/candidate/resumes/:id/file', { preHandler: app.authenticate }, async (request, reply) => {
    const actor = request.actor!;
    const resumeId = Number((request.params as { id: string }).id);
    const resume = await one<{ user_id: string; file_url: string; file_name: string }>(
      'SELECT user_id, file_url, file_name FROM resumes WHERE id = $1',
      [resumeId],
    );
    if (!resume) return fail(404, 'Resume not found');
    if (resume.file_url.startsWith('seed://')) return fail(404, 'Seed resume has no file');

    const allowed =
      resume.user_id === actor.id ||
      actor.permissions.includes('applications.view') ||
      (actor.permissions.includes('candidates.view') &&
        (await one(
          `SELECT 1 FROM mentor_assignments ma
           JOIN applications a ON a.id = ma.application_id
           WHERE a.user_id = $1 AND ma.mentor_id = $2 AND ma.status = 'active'`,
          [resume.user_id, actor.id],
        )) !== null);
    if (!allowed) return fail(403, 'Not allowed to read this resume');

    const filePath = path.join(UPLOAD_DIR, path.basename(resume.file_url));
    const file = await readFile(filePath);
    return reply
      .header('Content-Disposition', `attachment; filename="${encodeURIComponent(resume.file_name)}"`)
      .type('application/octet-stream')
      .send(file);
  });
}
