import type { FastifyInstance } from 'fastify';
import { one, query, withTransaction } from '@hi/db';
import {
  eventSchema,
  introductionResponseSchema,
  roundScore,
  submitAttemptSchema,
} from '@hi/shared';
import {
  audit,
  notify,
  requireKyc,
  requirePermission,
  requireRole,
} from '../auth';
import { autoScore } from '../lib/scoring';
import { fail } from '../lib/errors';

type RoundAccess = {
  round_id: number;
  candidate_id: string;
  mentor_id: string;
  round_status: string;
  scheduled_at: string | null;
  title: string;
  duration_minutes: number | null;
  decision: string | null;
  version_number: number | null;
  carried_score: string | number;
  reassessment_of_round_id: number | null;
};

async function candidateRound(roundId: number, candidateId: string): Promise<RoundAccess> {
  const row = await one<RoundAccess>(
    `SELECT r.id AS round_id, a.user_id AS candidate_id, ma.mentor_id, r.status AS round_status,
            r.scheduled_at, r.title, r.duration_minutes, r.decision, r.version_number,
            r.carried_score, r.reassessment_of_round_id
     FROM assessment_rounds r
     JOIN mentor_assignments ma ON ma.id = r.mentor_assignment_id
     JOIN applications a ON a.id = ma.application_id
     WHERE r.id = $1 AND a.user_id = $2`,
    [roundId, candidateId],
  );
  if (!row) fail(404, 'Round not found');
  return row;
}

async function attemptAccess(attemptId: number, candidateId: string) {
  const row = await one<{
    id: number;
    round_id: number;
    status: string;
    attempt_number: number;
    mentor_id: string;
    candidate_id: string;
    started_at: string;
    duration_minutes: number | null;
    carried_score: string | number;
  }>(
    `SELECT at.id, at.round_id, at.status, at.attempt_number, at.started_at,
            r.duration_minutes, r.carried_score, ma.mentor_id, a.user_id AS candidate_id
     FROM assessment_attempts at
     JOIN assessment_rounds r ON r.id = at.round_id
     JOIN mentor_assignments ma ON ma.id = r.mentor_assignment_id
     JOIN applications a ON a.id = ma.application_id
     WHERE at.id = $1 AND a.user_id = $2`,
    [attemptId, candidateId],
  );
  if (!row) fail(404, 'Attempt not found');
  return row;
}

async function roundQuestions(roundId: number) {
  return query(
    `SELECT q.id, q.question_key, q.question_text, q.question_type, q.options, q.marks,
            q.sequence_order, l.level_number, l.title AS level_title
     FROM assessment_questions q
     JOIN assessment_levels l ON l.id = q.level_id
     WHERE l.round_id = $1
     ORDER BY l.level_number, q.sequence_order`,
    [roundId],
  );
}

export async function candidateRoutes(app: FastifyInstance): Promise<void> {
  app.get('/candidate/rounds', { preHandler: app.authenticate }, async (request) => {
    const actor = request.actor!;
    requireRole(actor, 'candidate');
    requirePermission(actor, 'assessments.attempt');

    return query(
      `SELECT r.id, r.round_number, r.title, r.status, r.decision, r.scheduled_at,
              r.duration_minutes, r.next_assessment_at, r.remarks, r.version_number,
              r.carried_score, r.reassessment_of_round_id,
              ma.id AS assignment_id,
              (SELECT row_to_json(t) FROM (
                 SELECT at.id, at.attempt_number, at.status, at.total_score,
                        at.submitted_at, at.evaluated_at
                 FROM assessment_attempts at
                 WHERE at.round_id = r.id
                 ORDER BY at.attempt_number DESC LIMIT 1
               ) t) AS latest_attempt
       FROM assessment_rounds r
       JOIN mentor_assignments ma ON ma.id = r.mentor_assignment_id
       JOIN applications a ON a.id = ma.application_id
       WHERE a.user_id = $1
       ORDER BY r.scheduled_at DESC NULLS LAST, r.id DESC`,
      [actor.id],
    );
  });

  app.get('/candidate/rounds/:id', { preHandler: app.authenticate }, async (request) => {
    const actor = request.actor!;
    requireRole(actor, 'candidate');
    requirePermission(actor, 'assessments.attempt');
    const roundId = Number((request.params as { id: string }).id);
    const access = await candidateRound(roundId, actor.id);

    const [questions, attempts] = await Promise.all([
      roundQuestions(roundId),
      query(
        `SELECT id, attempt_number, status, total_score, started_at, submitted_at,
                evaluated_at, mentor_feedback
         FROM assessment_attempts WHERE round_id = $1 ORDER BY attempt_number DESC`,
        [roundId],
      ),
    ]);
    return {
      round: { ...access, id: roundId },
      questions,
      attempts,
      canStart:
        ['scheduled', 'open'].includes(access.round_status) &&
        !(attempts as Array<{ status: string }>).some((a) =>
          ['submitted', 'evaluated', 'expired'].includes(a.status),
        ),
    };
  });

  app.post('/candidate/rounds/:id/start', { preHandler: app.authenticate }, async (request) => {
    const actor = request.actor!;
    requireRole(actor, 'candidate');
    requirePermission(actor, 'assessments.attempt');
    requireKyc(actor);
    const roundId = Number((request.params as { id: string }).id);

    return withTransaction(async (client) => {
      const access = await candidateRound(roundId, actor.id);
      if (!['scheduled', 'open', 'in_progress'].includes(access.round_status)) {
        fail(409, 'This round is not open for attempts');
      }
      if (access.scheduled_at && new Date(access.scheduled_at) > new Date()) {
        fail(409, 'This round has not started yet');
      }

      const existing = await client.query<{
        id: number;
        attempt_number: number;
        status: string;
        started_at: string;
      }>(
        `SELECT id, attempt_number, status, started_at FROM assessment_attempts
         WHERE round_id = $1 ORDER BY attempt_number DESC LIMIT 1`,
        [roundId],
      );
      const last = existing.rows[0];
      if (last && ['submitted', 'evaluated', 'expired'].includes(last.status)) {
        fail(409, 'You have already submitted this round');
      }
      if (last && last.status === 'in_progress') {
        return {
          attempt: last,
          questions: await roundQuestions(roundId),
          resumed: true,
          carriedScore: Number(access.carried_score),
          durationMinutes: access.duration_minutes,
        };
      }

      const inserted = await client.query<{
        id: number;
        attempt_number: number;
        status: string;
        started_at: string;
      }>(
        `INSERT INTO assessment_attempts (round_id, attempt_number)
         VALUES ($1, COALESCE($2, 0) + 1)
         RETURNING id, attempt_number, status, started_at`,
        [roundId, last?.attempt_number ?? 0],
      );
      await client.query(`UPDATE assessment_rounds SET status = 'in_progress' WHERE id = $1`, [
        roundId,
      ]);
      await client.query(
        `INSERT INTO engagement_events (candidate_id, event_type)
         VALUES ($1, 'assessment_started')`,
        [actor.id],
      );
      await audit(client, actor.id, 'attempt.start', 'assessment_attempt', inserted.rows[0]!.id, {
        roundId,
      });

      return {
        attempt: inserted.rows[0],
        questions: await roundQuestions(roundId),
        resumed: false,
        carriedScore: Number(access.carried_score),
        durationMinutes: access.duration_minutes,
      };
    });
  });

  app.post('/candidate/attempts/:id/events', { preHandler: app.authenticate }, async (request) => {
    const actor = request.actor!;
    requireRole(actor, 'candidate');
    const attemptId = Number((request.params as { id: string }).id);
    const body = eventSchema.parse(request.body);
    const attempt = await attemptAccess(attemptId, actor.id);
    if (attempt.status !== 'in_progress') fail(409, 'Attempt is not in progress');

    await query(
      `INSERT INTO assessment_events (attempt_id, event_type, event_details)
       VALUES ($1, $2, $3)`,
      [attemptId, body.eventType, JSON.stringify(body.eventDetails ?? {})],
    );
    return { ok: true };
  });

  app.post('/candidate/attempts/:id/submit', { preHandler: app.authenticate }, async (request) => {
    const actor = request.actor!;
    requireRole(actor, 'candidate');
    requirePermission(actor, 'assessments.attempt');
    const attemptId = Number((request.params as { id: string }).id);
    const body = submitAttemptSchema.parse(request.body);
    const attempt = await attemptAccess(attemptId, actor.id);
    if (attempt.status !== 'in_progress') fail(409, 'Attempt was already submitted');

    const elapsedSeconds = Math.max(
      0,
      Math.round((Date.now() - new Date(attempt.started_at).getTime()) / 1000),
    );
    const timedOut =
      attempt.duration_minutes !== null &&
      elapsedSeconds > attempt.duration_minutes * 60 + 60;

    return withTransaction(async (client) => {
      const questions = await client.query<{
        id: number;
        question_type: string;
        answer_key: string | null;
        marks: string;
      }>(
        `SELECT q.id, q.question_type, q.answer_key, q.marks
         FROM assessment_questions q
         JOIN assessment_levels l ON l.id = q.level_id
         WHERE l.round_id = $1`,
        [attempt.round_id],
      );

      let total = 0;
      for (const question of questions.rows) {
        const supplied = body.answers.find((a) => a.questionId === question.id);
        const answer = supplied === undefined ? null : supplied.answer;
        const score = autoScore(
          question.question_type as never,
          question.answer_key,
          answer,
          Number(question.marks),
        );
        if (score !== null) total += score;
        await client.query(
          `INSERT INTO candidate_answers (attempt_id, question_id, answer, auto_score)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (attempt_id, question_id) DO UPDATE
           SET answer = EXCLUDED.answer, auto_score = EXCLUDED.auto_score`,
          [attemptId, question.id, JSON.stringify(answer), score],
        );
      }

      const totalScore = roundScore(Number(attempt.carried_score) + total);
      const status = timedOut ? 'expired' : 'submitted';
      await client.query(
        `INSERT INTO assessment_events (attempt_id, event_type, event_details)
         VALUES ($1, 'time_elapsed', $2)`,
        [attemptId, JSON.stringify({ elapsedSeconds, timedOut })],
      );
      await client.query(
        `UPDATE assessment_attempts
         SET status = $1, submitted_at = now(), total_score = $2
         WHERE id = $3`,
        [status, totalScore, attemptId],
      );
      await client.query(
        `INSERT INTO engagement_events (candidate_id, event_type)
         VALUES ($1, 'assessment_submitted')`,
        [actor.id],
      );
      await notify(
        client,
        attempt.mentor_id,
        `${actor.firstName} ${actor.lastName} submitted an assessment.`,
        'assessment',
      );
      await audit(client, actor.id, 'attempt.submit', 'assessment_attempt', attemptId, {
        totalScore,
        carriedScore: Number(attempt.carried_score),
        elapsedSeconds,
        timedOut,
      });

      return {
        attemptId,
        totalScore,
        carriedScore: Number(attempt.carried_score),
        status,
        elapsedSeconds,
      };
    });
  });

  app.get('/candidate/attempts/:id/result', { preHandler: app.authenticate }, async (request) => {
    const actor = request.actor!;
    requireRole(actor, 'candidate');
    const attemptId = Number((request.params as { id: string }).id);
    await attemptAccess(attemptId, actor.id);

    const attempt = await one(
      `SELECT at.id, at.round_id, at.attempt_number, at.status, at.total_score, at.started_at,
              at.submitted_at, at.evaluated_at, at.mentor_feedback, r.carried_score,
              r.reassessment_of_round_id
       FROM assessment_attempts at
       JOIN assessment_rounds r ON r.id = at.round_id
       WHERE at.id = $1`,
      [attemptId],
    );
    const answers = await query(
      `SELECT ca.question_id, ca.answer, ca.auto_score, ca.ai_score, ca.mentor_score,
              ca.final_score, ca.feedback, q.question_text, q.question_type, q.marks
       FROM candidate_answers ca
       JOIN assessment_questions q ON q.id = ca.question_id
       WHERE ca.attempt_id = $1
       ORDER BY q.sequence_order`,
      [attemptId],
    );
    const maxScore = await one<{ max: string | null }>(
      `SELECT sum(q.marks) AS max
       FROM assessment_questions q
       JOIN assessment_levels l ON l.id = q.level_id
       JOIN assessment_attempts at ON at.round_id = l.round_id
       WHERE at.id = $1`,
      [attemptId],
    );
    const carriedScore = Number((attempt as { carried_score?: string | number })?.carried_score ?? 0);
    return { attempt, answers, maxScore: Number(maxScore?.max ?? 0), carriedScore };
  });

  app.get('/candidate/introductions', { preHandler: app.authenticate }, async (request) => {
    const actor = request.actor!;
    requireRole(actor, 'candidate');
    return query(
      `SELECT ir.id, ir.message, ir.status, ir.requested_at, ir.responded_at,
              c.company_name, c.industry, c.website,
              u.first_name AS requester_first_name, u.last_name AS requester_last_name,
              CASE WHEN ir.status = 'accepted' THEN u.email END AS requester_email
       FROM introduction_requests ir
       JOIN companies c ON c.id = ir.company_id
       JOIN users u ON u.id = ir.requested_by
       WHERE ir.candidate_id = $1
       ORDER BY ir.requested_at DESC`,
      [actor.id],
    );
  });

  app.post(
    '/candidate/introductions/:id/respond',
    { preHandler: app.authenticate },
    async (request) => {
      const actor = request.actor!;
      requireRole(actor, 'candidate');
      requirePermission(actor, 'introductions.respond');
      const id = Number((request.params as { id: string }).id);
      const body = introductionResponseSchema.parse(request.body);

      await withTransaction(async (client) => {
        const row = await client.query<{ requested_by: string; status: string }>(
          `SELECT requested_by, status FROM introduction_requests
           WHERE id = $1 AND candidate_id = $2 FOR UPDATE`,
          [id, actor.id],
        );
        if (!row.rowCount) fail(404, 'Introduction request not found');
        if (row.rows[0]!.status !== 'pending') fail(409, 'Request already answered');

        await client.query(
          `UPDATE introduction_requests SET status = $1, responded_at = now() WHERE id = $2`,
          [body.status, id],
        );
        await notify(
          client,
          row.rows[0]!.requested_by,
          `A candidate ${body.status} your introduction request.`,
          'introduction',
        );
        await audit(client, actor.id, 'introduction.respond', 'introduction_request', id, {
          status: body.status,
        });
      });
      return { ok: true };
    },
  );
}
