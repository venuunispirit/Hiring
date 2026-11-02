import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { cloneSnapshotToRound, one, query, withTransaction } from '@hi/db';
import {
  decisionSchema,
  diffSnapshots,
  evaluateSchema,
  roundSchema,
  roundScore,
  snapshotSchema,
  templateSchema,
  totalMarks,
  type Snapshot,
} from '@hi/shared';
import {
  audit,
  enqueue,
  notify,
  requirePermission,
  requireRole,
} from '../auth';
import { fail } from '../lib/errors';

function validateSnapshot(snapshot: Snapshot): void {
  const keys = new Set<string>();
  for (const level of snapshot.levels) {
    for (const question of level.questions) {
      if (keys.has(question.questionKey)) {
        fail(400, `Duplicate question key: ${question.questionKey}`);
      }
      keys.add(question.questionKey);

      if (['mcq', 'multiple_select', 'true_false'].includes(question.questionType)) {
        if (!question.options || question.options.length < 2) {
          fail(400, `Question ${question.questionKey} needs at least two options`);
        }
      }
      if (
        ['mcq', 'multiple_select', 'true_false', 'short_answer'].includes(question.questionType) &&
        !question.answerKey
      ) {
        fail(400, `Question ${question.questionKey} needs an answer key for auto-scoring`);
      }
    }
  }
}

async function assertAssignment(client: pg.PoolClient, assignmentId: number, mentorId: string) {
  const found = await client.query<{
    id: number;
    application_id: number;
    candidate_id: string;
    status: string;
  }>(
    `SELECT ma.id, ma.application_id, a.user_id AS candidate_id, ma.status
     FROM mentor_assignments ma
     JOIN applications a ON a.id = ma.application_id
     WHERE ma.id = $1 AND ma.mentor_id = $2`,
    [assignmentId, mentorId],
  );
  const row = found.rows[0];
  if (!row) fail(404, 'Assignment not found');
  return row;
}

export async function mentorRoutes(app: FastifyInstance): Promise<void> {
  app.get('/mentor/candidates', { preHandler: app.authenticate }, async (request) => {
    const actor = request.actor!;
    requireRole(actor, 'mentor');
    requirePermission(actor, 'candidates.view');

    return query(
      `SELECT ma.id, ma.status, ma.assigned_at,
              a.id AS application_id, u.id AS candidate_id, u.first_name, u.last_name, u.email,
              p.professional_title, p.total_experience_years, p.location,
              jr.title AS job_role,
              (SELECT count(*) FROM assessment_rounds r
               WHERE r.mentor_assignment_id = ma.id) AS rounds_count,
              (SELECT max(at.total_score)
               FROM assessment_attempts at
               JOIN assessment_rounds r ON r.id = at.round_id
               WHERE r.mentor_assignment_id = ma.id AND at.status = 'evaluated') AS best_score,
              (SELECT r2.decision FROM assessment_rounds r2
               WHERE r2.mentor_assignment_id = ma.id AND r2.decision IS NOT NULL
               ORDER BY r2.decided_at DESC NULLS LAST LIMIT 1) AS latest_decision
       FROM mentor_assignments ma
       JOIN applications a ON a.id = ma.application_id
       JOIN users u ON u.id = a.user_id
       LEFT JOIN profiles p ON p.user_id = u.id
       LEFT JOIN job_roles jr ON jr.id = a.job_role_id
       WHERE ma.mentor_id = $1
       ORDER BY ma.assigned_at DESC`,
      [actor.id],
    );
  });

  app.get('/mentor/assignments/:id', { preHandler: app.authenticate }, async (request) => {
    const actor = request.actor!;
    requireRole(actor, 'mentor');
    requirePermission(actor, 'candidates.view');
    const assignmentId = Number((request.params as { id: string }).id);

    const assignment = await one(
      `SELECT ma.id, ma.status, ma.assigned_at, ma.ended_at,
              a.id AS application_id, u.id AS candidate_id, u.first_name, u.last_name, u.email,
              p.public_ref, p.professional_title, p.total_experience_years, p.location,
              p.education, p.bio, p.availability, jr.title AS job_role,
              (SELECT json_agg(json_build_object('skill', s.skill_name, 'years', us.experience_years))
               FROM user_skills us JOIN skills s ON s.id = us.skill_id
               WHERE us.user_id = u.id) AS skills
       FROM mentor_assignments ma
       JOIN applications a ON a.id = ma.application_id
       JOIN users u ON u.id = a.user_id
       LEFT JOIN profiles p ON p.user_id = u.id
       LEFT JOIN job_roles jr ON jr.id = a.job_role_id
       WHERE ma.id = $1 AND ma.mentor_id = $2`,
      [assignmentId, actor.id],
    );
    if (!assignment) return fail(404, 'Assignment not found');

    const rounds = await query(
      `SELECT r.*,
              (SELECT row_to_json(t) FROM (
                 SELECT at.id, at.attempt_number, at.status, at.total_score,
                        at.started_at, at.submitted_at, at.evaluated_at
                 FROM assessment_attempts at
                 WHERE at.round_id = r.id
                 ORDER BY at.attempt_number DESC LIMIT 1
               ) t) AS latest_attempt
       FROM assessment_rounds r
       WHERE r.mentor_assignment_id = $1
       ORDER BY r.round_number`,
      [assignmentId],
    );

    return { assignment, rounds };
  });

  app.get('/mentor/templates', { preHandler: app.authenticate }, async (request) => {
    const actor = request.actor!;
    requireRole(actor, 'mentor');
    requirePermission(actor, 'assessments.manage');

    return query(
      `SELECT t.id, t.title, t.status, t.created_at,
              (SELECT version_number FROM template_versions v
               WHERE v.template_id = t.id ORDER BY version_number DESC LIMIT 1) AS latest_version,
              (SELECT count(*) FROM template_versions v
               WHERE v.template_id = t.id) AS versions,
              (SELECT count(*) FROM assessment_rounds r
               JOIN template_versions v ON v.id = r.template_version_id
               WHERE v.template_id = t.id) AS rounds_using
       FROM assessment_templates t
       WHERE t.mentor_id = $1
       ORDER BY t.created_at DESC`,
      [actor.id],
    );
  });

  app.get('/mentor/templates/:id', { preHandler: app.authenticate }, async (request) => {
    const actor = request.actor!;
    requireRole(actor, 'mentor');
    requirePermission(actor, 'assessments.manage');
    const templateId = Number((request.params as { id: string }).id);

    const template = await one<{ id: number; title: string; status: string }>(
      'SELECT id, title, status FROM assessment_templates WHERE id = $1 AND mentor_id = $2',
      [templateId, actor.id],
    );
    if (!template) return fail(404, 'Template not found');

    const versions = await query(
      `SELECT id, version_number, snapshot, published_at
       FROM template_versions WHERE template_id = $1 ORDER BY version_number DESC`,
      [templateId],
    );
    return { ...template, versions };
  });

  // Publishing is the only write path: versions are immutable, so an edit is
  // always a new version and earlier attempts keep their exact questions.
  app.post('/mentor/templates', { preHandler: app.authenticate }, async (request, reply) => {
    const actor = request.actor!;
    requireRole(actor, 'mentor');
    requirePermission(actor, 'assessments.manage');
    const body = templateSchema.parse(request.body);
    const snapshot = snapshotSchema.parse(body.snapshot);
    validateSnapshot(snapshot);

    const id = await withTransaction(async (client) => {
      const template = await client.query<{ id: number }>(
        `INSERT INTO assessment_templates (mentor_id, title, status)
         VALUES ($1, $2, 'published') RETURNING id`,
        [actor.id, body.title],
      );
      const templateId = template.rows[0]!.id;
      await client.query(
        `INSERT INTO template_versions (template_id, version_number, snapshot)
         VALUES ($1, 1, $2)`,
        [templateId, JSON.stringify(snapshot)],
      );
      await audit(client, actor.id, 'template.publish', 'assessment_template', templateId, {
        version: 1,
        questions: totalMarks(snapshot),
      });
      return templateId;
    });

    return reply.code(201).send({ id, version: 1 });
  });

  app.post('/mentor/templates/:id/versions', { preHandler: app.authenticate }, async (request) => {
    const actor = request.actor!;
    requireRole(actor, 'mentor');
    requirePermission(actor, 'assessments.manage');
    const templateId = Number((request.params as { id: string }).id);
    const body = templateSchema.parse(request.body);
    const next = snapshotSchema.parse(body.snapshot);
    validateSnapshot(next);

    return withTransaction(async (client) => {
      const template = await client.query<{ id: number; title: string }>(
        'SELECT id, title FROM assessment_templates WHERE id = $1 AND mentor_id = $2',
        [templateId, actor.id],
      );
      if (!template.rowCount) fail(404, 'Template not found');

      const latest = await client.query<{ id: number; version_number: number; snapshot: Snapshot }>(
        `SELECT id, version_number, snapshot FROM template_versions
         WHERE template_id = $1 ORDER BY version_number DESC LIMIT 1`,
        [templateId],
      );
      const previous = latest.rows[0];
      if (!previous) fail(400, 'Template has no published version');

      const diff = diffSnapshots(previous.snapshot, next);
      if (!diff.added.length && !diff.removed.length && !diff.changed.length) {
        fail(400, 'No changes to publish');
      }

      const versionNumber = previous.version_number + 1;
      const version = await client.query<{ id: number }>(
        `INSERT INTO template_versions (template_id, version_number, snapshot)
         VALUES ($1, $2, $3) RETURNING id`,
        [templateId, versionNumber, JSON.stringify(next)],
      );
      const versionId = version.rows[0]!.id;

      const affected = await client.query<{ mentor_assignment_id: number }>(
        `SELECT DISTINCT r.mentor_assignment_id
         FROM assessment_rounds r
         JOIN template_versions v ON v.id = r.template_version_id
         WHERE v.template_id = $1 AND v.version_number < $2`,
        [templateId, versionNumber],
      );

      for (const row of affected.rows) {
        await enqueue(client, 'reassess', {
          assignmentId: row.mentor_assignment_id,
          templateId,
          versionId,
          versionNumber,
          diff,
        });
      }

      await client.query('UPDATE assessment_templates SET status = $1 WHERE id = $2', [
        'published',
        templateId,
      ]);
      await audit(client, actor.id, 'template.publish', 'assessment_template', templateId, {
        version: versionNumber,
        diff,
        affected: affected.rowCount,
      });

      return { version: versionNumber, diff, affected: affected.rowCount };
    });
  });

  app.post('/mentor/templates/:id/impact', { preHandler: app.authenticate }, async (request) => {
    const actor = request.actor!;
    requireRole(actor, 'mentor');
    requirePermission(actor, 'assessments.manage');
    const templateId = Number((request.params as { id: string }).id);
    const body = templateSchema.parse(request.body);
    const next = snapshotSchema.parse(body.snapshot);

    const latest = await one<{ version_number: number; snapshot: Snapshot }>(
      `SELECT v.version_number, v.snapshot FROM template_versions v
       JOIN assessment_templates t ON t.id = v.template_id
       WHERE v.template_id = $1 AND t.mentor_id = $2
       ORDER BY v.version_number DESC LIMIT 1`,
      [templateId, actor.id],
    );
    if (!latest) fail(404, 'Template not found');

    const diff = diffSnapshots(latest.snapshot, next);
    const affected = await query(
      `SELECT DISTINCT ma.id AS assignment_id, u.first_name, u.last_name
       FROM assessment_rounds r
       JOIN template_versions v ON v.id = r.template_version_id
       JOIN mentor_assignments ma ON ma.id = r.mentor_assignment_id
       JOIN applications a ON a.id = ma.application_id
       JOIN users u ON u.id = a.user_id
       WHERE v.template_id = $1 AND v.version_number < $2`,
      [templateId, latest.version_number + 1],
    ).catch(() => []);
    return { diff, affected: affected.length, candidates: affected };
  });

  app.post('/mentor/rounds', { preHandler: app.authenticate }, async (request, reply) => {
    const actor = request.actor!;
    requireRole(actor, 'mentor');
    requirePermission(actor, 'assessments.manage');
    const body = roundSchema.parse(request.body);

    const roundId = await withTransaction(async (client) => {
      const assignment = await assertAssignment(client, body.mentorAssignmentId, actor.id);
      if (assignment.status !== 'active') fail(400, 'Assignment is not active');

      const version = await client.query<{ id: number; version_number: number; snapshot: Snapshot }>(
        `SELECT v.id, v.version_number, v.snapshot
         FROM template_versions v
         JOIN assessment_templates t ON t.id = v.template_id
         WHERE t.id = $1 AND t.mentor_id = $2
         ORDER BY v.version_number DESC LIMIT 1`,
        [body.templateId, actor.id],
      );
      const latest = version.rows[0];
      if (!latest) fail(404, 'Template not found');
      const snapshot = latest.snapshot;

      const count = await client.query<{ next: number }>(
        `SELECT COALESCE(max(round_number), 0) + 1 AS next
         FROM assessment_rounds WHERE mentor_assignment_id = $1`,
        [body.mentorAssignmentId],
      );
      const roundNumber = count.rows[0]!.next;

      const inserted = await client.query<{ id: number }>(
        `INSERT INTO assessment_rounds
           (mentor_assignment_id, template_version_id, version_number, round_number, title,
            scheduled_at, duration_minutes, status)
         VALUES ($1, $2, $3, $4, $5,
                 COALESCE($6::timestamptz, now()), $7, 'scheduled')
         RETURNING id`,
        [
          body.mentorAssignmentId,
          latest.id,
          latest.version_number,
          roundNumber,
          snapshot.title,
          body.scheduledAt ?? null,
          snapshot.durationMinutes,
        ],
      );
      const id = inserted.rows[0]!.id;
      await cloneSnapshotToRound(client, id, snapshot);
      await notify(
        client,
        assignment.candidate_id,
        `A new assessment round "${snapshot.title}" was scheduled.`,
        'assessment',
      );
      await audit(client, actor.id, 'round.create', 'assessment_round', id, {
        assignmentId: body.mentorAssignmentId,
        version: latest.version_number,
        roundNumber,
      });
      return id;
    });

    return reply.code(201).send({ id: roundId });
  });

  app.get('/mentor/rounds/:id', { preHandler: app.authenticate }, async (request) => {
    const actor = request.actor!;
    requireRole(actor, 'mentor');
    requirePermission(actor, 'assessments.monitor');
    const roundId = Number((request.params as { id: string }).id);

    const round = await one(
      `SELECT r.*, ma.mentor_id, a.user_id AS candidate_id,
              u.first_name, u.last_name, u.email
       FROM assessment_rounds r
       JOIN mentor_assignments ma ON ma.id = r.mentor_assignment_id
       JOIN applications a ON a.id = ma.application_id
       JOIN users u ON u.id = a.user_id
       WHERE r.id = $1 AND ma.mentor_id = $2`,
      [roundId, actor.id],
    );
    if (!round) return fail(404, 'Round not found');

    const questions = await query(
      `SELECT q.id, q.question_key, q.question_text, q.question_type, q.options, q.answer_key,
              q.marks, q.sequence_order, l.level_number, l.title AS level_title
       FROM assessment_questions q
       JOIN assessment_levels l ON l.id = q.level_id
       WHERE l.round_id = $1
       ORDER BY l.level_number, q.sequence_order`,
      [roundId],
    );

    const attempts = await query(
      `SELECT at.id, at.attempt_number, at.status, at.total_score, at.started_at,
              at.submitted_at, at.evaluated_at, at.mentor_feedback,
              (SELECT count(*) FROM assessment_events e WHERE e.attempt_id = at.id) AS event_count
       FROM assessment_attempts at
       WHERE at.round_id = $1 ORDER BY at.attempt_number`,
      [roundId],
    );

    const answers = await query(
      `SELECT ca.attempt_id, ca.question_id, ca.answer, ca.auto_score, ca.ai_score,
              ca.mentor_score, ca.final_score, ca.feedback,
              q.question_text, q.question_type, q.marks, q.answer_key
       FROM candidate_answers ca
       JOIN assessment_questions q ON q.id = ca.question_id
       JOIN assessment_attempts at ON at.id = ca.attempt_id
       WHERE at.round_id = $1
       ORDER BY ca.attempt_id, q.sequence_order`,
      [roundId],
    );

    const events = await query(
      `SELECT e.id, e.attempt_id, e.event_type, e.event_timestamp, e.event_details
       FROM assessment_events e
       JOIN assessment_attempts at ON at.id = e.attempt_id
       WHERE at.round_id = $1
       ORDER BY e.event_timestamp`,
      [roundId],
    );

    return { round, questions, attempts, answers, events };
  });

  app.post('/mentor/attempts/:id/evaluate', { preHandler: app.authenticate }, async (request) => {
    const actor = request.actor!;
    requireRole(actor, 'mentor');
    requirePermission(actor, 'assessments.evaluate');
    const attemptId = Number((request.params as { id: string }).id);
    const body = evaluateSchema.parse(request.body);

    return withTransaction(async (client) => {
      const attempt = await client.query<{
        id: number;
        round_id: number;
        candidate_id: string;
        status: string;
      }>(
        `SELECT at.id, at.round_id, a.user_id AS candidate_id, at.status
         FROM assessment_attempts at
         JOIN assessment_rounds r ON r.id = at.round_id
         JOIN mentor_assignments ma ON ma.id = r.mentor_assignment_id
         JOIN applications a ON a.id = ma.application_id
         WHERE at.id = $1 AND ma.mentor_id = $2`,
        [attemptId, actor.id],
      );
      const row = attempt.rows[0];
      if (!row) fail(404, 'Attempt not found');
      if (row.status === 'in_progress') fail(400, 'Attempt has not been submitted');

      for (const score of body.scores) {
        const exists = await client.query(
          'SELECT 1 FROM candidate_answers WHERE attempt_id = $1 AND question_id = $2',
          [attemptId, score.questionId],
        );
        if (!exists.rowCount) fail(400, `Question ${score.questionId} is not part of this attempt`);
        await client.query(
          `UPDATE candidate_answers
           SET mentor_score = $1, feedback = $2
           WHERE attempt_id = $3 AND question_id = $4`,
          [score.mentorScore, score.feedback ?? null, attemptId, score.questionId],
        );
      }

      const [total, round] = await Promise.all([
        client.query<{ total: string | null }>(
          'SELECT sum(final_score) AS total FROM candidate_answers WHERE attempt_id = $1',
          [attemptId],
        ),
        client.query<{ carried_score: string }>(
          'SELECT carried_score FROM assessment_rounds WHERE id = $1',
          [row.round_id],
        ),
      ]);
      const carriedScore = Number(round.rows[0]?.carried_score ?? 0);
      const totalScore = roundScore(carriedScore + Number(total.rows[0]?.total ?? 0));

      await client.query(
        `UPDATE assessment_attempts
         SET status = $1, total_score = $2, mentor_feedback = $3, evaluated_at = now()
         WHERE id = $4`,
        [body.status, totalScore, body.mentorFeedback ?? null, attemptId],
      );
      await notify(
        client,
        row.candidate_id,
        `Your assessment was evaluated. Score: ${totalScore}.`,
        'result',
      );
      await audit(client, actor.id, 'attempt.evaluate', 'assessment_attempt', attemptId, {
        totalScore,
        carriedScore,
      });
      return { totalScore, carriedScore, status: body.status };
    });
  });

  app.post('/mentor/rounds/:id/decision', { preHandler: app.authenticate }, async (request) => {
    const actor = request.actor!;
    requireRole(actor, 'mentor');
    requirePermission(actor, 'assessments.evaluate');
    const roundId = Number((request.params as { id: string }).id);
    const body = decisionSchema.parse(request.body);

    await withTransaction(async (client) => {
      const round = await client.query<{ candidate_id: string }>(
        `SELECT a.user_id AS candidate_id
         FROM assessment_rounds r
         JOIN mentor_assignments ma ON ma.id = r.mentor_assignment_id
         JOIN applications a ON a.id = ma.application_id
         WHERE r.id = $1 AND ma.mentor_id = $2`,
        [roundId, actor.id],
      );
      if (!round.rowCount) fail(404, 'Round not found');

      await client.query(
        `UPDATE assessment_rounds
         SET decision = $1, remarks = $2, next_assessment_at = $3, decided_at = now(),
             status = $4
         WHERE id = $5`,
        [
          body.decision,
          body.remarks ?? null,
          body.nextAssessmentAt ?? null,
          body.decision === 'reschedule' ? 'scheduled' : 'completed',
          roundId,
        ],
      );
      await notify(
        client,
        round.rows[0]!.candidate_id,
        `A decision was recorded for your assessment: ${body.decision}.`,
        'result',
      );
      await audit(client, actor.id, 'round.decision', 'assessment_round', roundId, {
        decision: body.decision,
      });
    });
    return { ok: true };
  });

  app.get('/mentor/rankings', { preHandler: app.authenticate }, async (request) => {
    const actor = request.actor!;
    requireRole(actor, 'mentor');
    requirePermission(actor, 'candidates.view');

    return query(
      `SELECT * FROM (
         SELECT DISTINCT ON (ma.id)
                ma.id AS assignment_id, u.first_name, u.last_name, u.email,
                p.professional_title, p.total_experience_years,
                r.round_number, r.version_number, r.decision,
                at.total_score, at.evaluated_at
         FROM mentor_assignments ma
         JOIN applications a ON a.id = ma.application_id
         JOIN users u ON u.id = a.user_id
         LEFT JOIN profiles p ON p.user_id = u.id
         LEFT JOIN assessment_rounds r ON r.mentor_assignment_id = ma.id
         LEFT JOIN assessment_attempts at ON at.round_id = r.id AND at.status = 'evaluated'
         WHERE ma.mentor_id = $1
         ORDER BY ma.id, at.total_score DESC NULLS LAST
       ) ranked
       ORDER BY total_score DESC NULLS LAST`,
      [actor.id],
    );
  });
}
