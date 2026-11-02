import { cloneSnapshotToRound, one, pool, query, withTransaction } from '@hi/db';
import {
  flattenSnapshot,
  questionSignature,
  roundScore,
  type Snapshot,
} from '@hi/shared';
import { audit, notify } from './auth';

type Job = {
  id: number;
  type: string;
  payload: {
    assignmentId?: number;
    templateId?: number;
    versionId?: number;
    versionNumber?: number;
  };
  attempts: number;
};

type Delta = {
  snapshot: Snapshot;
  carriedScore: number;
  carriedScores: Record<string, number>;
  changedKeys: string[];
  previousRoundId: number;
};

/**
 * Build the delta between the version the candidate actually attempted and
 * the newly published version. Unchanged question keys reuse the stored final
 * score; only changed/new keys are copied into the new round.
 */
function buildDelta(
  previous: Snapshot,
  next: Snapshot,
  previousScores: Map<string, number>,
  previousRoundId: number,
): Delta {
  const before = flattenSnapshot(previous);
  const levels: Snapshot['levels'] = [];
  const changedKeys: string[] = [];
  const carriedScores: Record<string, number> = {};
  let carried = 0;

  for (const level of next.levels) {
    const questions = level.questions.filter((question) => {
      const unchanged =
        before.has(question.questionKey) &&
        before.get(question.questionKey) === questionSignature(question);
      if (unchanged) {
        const score = previousScores.get(question.questionKey) ?? 0;
        carried += score;
        carriedScores[question.questionKey] = score;
        return false;
      }
      changedKeys.push(question.questionKey);
      return true;
    });
    if (questions.length) levels.push({ ...level, questions });
  }

  return {
    snapshot: { ...next, levels },
    carriedScore: roundScore(carried),
    carriedScores,
    changedKeys,
    previousRoundId,
  };
}

async function processReassessment(job: Job): Promise<void> {
  const { assignmentId, versionId, versionNumber, templateId } = job.payload;
  if (!assignmentId || !versionId || !versionNumber || !templateId) {
    throw new Error('reassess job is missing payload fields');
  }

  await withTransaction(async (client) => {
    const version = await client.query<{ snapshot: Snapshot }>(
      'SELECT snapshot FROM template_versions WHERE id = $1',
      [versionId],
    );
    if (!version.rowCount) throw new Error('Template version not found');
    const snapshot = version.rows[0]!.snapshot;

    const assignment = await client.query<{ candidate_id: string; status: string }>(
      `SELECT a.user_id AS candidate_id, ma.status
       FROM mentor_assignments ma JOIN applications a ON a.id = ma.application_id
       WHERE ma.id = $1`,
      [assignmentId],
    );
    if (!assignment.rowCount) throw new Error('Assignment not found');
    if (assignment.rows[0]!.status !== 'active') return;

    const already = await client.query(
      `SELECT 1 FROM assessment_rounds
       WHERE mentor_assignment_id = $1 AND template_version_id = $2`,
      [assignmentId, versionId],
    );
    if (already.rowCount) return;

    // Compare against the version this candidate actually sat, not merely the
    // immediately previous template version.
    const prior = await client.query<{
      round_id: number;
      attempt_id: number;
      snapshot: Snapshot;
      carried_scores: Record<string, number> | null;
    }>(
      `SELECT r.id AS round_id, at.id AS attempt_id, v.snapshot, r.carried_scores
       FROM assessment_rounds r
       JOIN assessment_attempts at ON at.round_id = r.id
       JOIN template_versions v ON v.id = r.template_version_id
       WHERE r.mentor_assignment_id = $1
         AND v.template_id = $2
         AND v.version_number < $3
         AND at.status IN ('submitted', 'evaluated', 'expired')
       ORDER BY at.id DESC
       LIMIT 1`,
      [assignmentId, templateId, versionNumber],
    );
    if (!prior.rowCount) return;

    const priorRound = prior.rows[0]!;
    const answers = await client.query<{ question_key: string; final_score: string | null }>(
      `SELECT q.question_key, ca.final_score
       FROM candidate_answers ca
       JOIN assessment_questions q ON q.id = ca.question_id
       WHERE ca.attempt_id = $1`,
      [priorRound.attempt_id],
    );
    const previousScores = new Map<string, number>(
      Object.entries(priorRound.carried_scores ?? {}).map(([key, value]) => [
        key,
        Number(value),
      ]),
    );
    for (const row of answers.rows) {
      previousScores.set(row.question_key, Number(row.final_score ?? 0));
    }

    const delta = buildDelta(priorRound.snapshot, snapshot, previousScores, priorRound.round_id);
    if (delta.snapshot.levels.length === 0) {
      // Only removals: there is nothing new to ask. Keep history untouched.
      await audit(client, null, 'reassessment.no_delta', 'assessment_round', priorRound.round_id, {
        assignmentId,
        versionNumber,
      });
      return;
    }

    const next = await client.query<{ next: number }>(
      `SELECT COALESCE(max(round_number), 0) + 1 AS next
       FROM assessment_rounds WHERE mentor_assignment_id = $1`,
      [assignmentId],
    );
    const roundNumber = next.rows[0]!.next;

    const round = await client.query<{ id: number }>(
      `INSERT INTO assessment_rounds
         (mentor_assignment_id, template_version_id, version_number, round_number, title,
          scheduled_at, duration_minutes, status, reassessment_of_round_id, carried_score,
          carried_scores)
       VALUES ($1, $2, $3, $4, $5, now() + interval '1 day', $6, 'scheduled', $7, $8, $9)
       RETURNING id`,
      [
        assignmentId,
        versionId,
        versionNumber,
        roundNumber,
        `${snapshot.title} (re-assessment v${versionNumber})`,
        snapshot.durationMinutes,
        priorRound.round_id,
        delta.carriedScore,
        JSON.stringify(delta.carriedScores),
      ],
    );
    const roundId = round.rows[0]!.id;
    await cloneSnapshotToRound(client, roundId, delta.snapshot);

    const candidateId = assignment.rows[0]!.candidate_id;
    await notify(
      client,
      candidateId,
      `Assessment v${versionNumber} has ${delta.changedKeys.length} updated question(s). ` +
        `Your previous score of ${delta.carriedScore} is carried forward.`,
      'assessment',
    );
    await client.query(
      `INSERT INTO engagement_events (candidate_id, event_type)
       VALUES ($1, 'reassessment_invited')`,
      [candidateId],
    );
    await audit(client, null, 'reassessment.create', 'assessment_round', roundId, {
      assignmentId,
      versionNumber,
      previousRoundId: delta.previousRoundId,
      changedKeys: delta.changedKeys,
      carriedScore: delta.carriedScore,
    });
  });
}

async function processJob(job: Job): Promise<void> {
  if (job.type !== 'reassess') throw new Error(`Unknown job type: ${job.type}`);
  await processReassessment(job);
}

let busy = false;

async function tick(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const job = await one<Job>(
      `UPDATE jobs
       SET status = 'running', locked_at = now(), attempts = attempts + 1
       WHERE id = (
         SELECT id FROM jobs
         WHERE status = 'pending' AND run_at <= now()
         ORDER BY id
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       RETURNING id, type, payload, attempts`,
    );
    if (!job) return;

    try {
      await processJob(job);
      await pool.query(
        `UPDATE jobs SET status = 'done', last_error = null WHERE id = $1`,
        [job.id],
      );
      console.log(`Job ${job.id} (${job.type}) done`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed = job.attempts >= 3;
      await pool.query(
        `UPDATE jobs
         SET status = $1, last_error = $2, locked_at = null,
             run_at = now() + ($3 || ' seconds')::interval
         WHERE id = $4`,
        [failed ? 'failed' : 'pending', message, String(job.attempts * 30), job.id],
      );
      console.error(`Job ${job.id} failed: ${message}`);
    }
  } finally {
    busy = false;
  }
}

/**
 * Yearly freshness sweep: flag evaluated attempts older than the configured
 * threshold once per attempt, then notify the candidate and mentor.
 */
async function staleSweep(): Promise<void> {
  const setting = await one<{ value: number }>(
    `SELECT value FROM platform_settings WHERE key = 'stale_assessment_days'`,
  );
  const days = Number(setting?.value ?? 365);
  const rows = await query<{
    attempt_id: number;
    candidate_id: string;
    mentor_id: string;
    title: string;
  }>(
    `SELECT at.id AS attempt_id, a.user_id AS candidate_id, ma.mentor_id, r.title
     FROM assessment_attempts at
     JOIN assessment_rounds r ON r.id = at.round_id
     JOIN mentor_assignments ma ON ma.id = r.mentor_assignment_id
     JOIN applications a ON a.id = ma.application_id
     WHERE at.status = 'evaluated'
       AND at.evaluated_at < now() - ($1 || ' days')::interval
       AND NOT EXISTS (
         SELECT 1 FROM audit_logs al
         WHERE al.action = 'assessment.stale_flagged'
           AND al.entity_type = 'assessment_attempt'
           AND al.entity_id = at.id::text
       )
     ORDER BY at.evaluated_at
     LIMIT 200`,
    [String(days)],
  );

  for (const row of rows) {
    await withTransaction(async (client) => {
      await notify(
        client,
        row.candidate_id,
        `Your assessment "${row.title}" is older than ${days} days. Ask your mentor for a re-assessment.`,
        'assessment',
      );
      await notify(
        client,
        row.mentor_id,
        `A candidate's assessment "${row.title}" is older than ${days} days and may need a re-assessment.`,
        'assessment',
      );
      await client.query(
        `INSERT INTO engagement_events (candidate_id, event_type)
         VALUES ($1, 'assessment_stale')`,
        [row.candidate_id],
      );
      await audit(client, null, 'assessment.stale_flagged', 'assessment_attempt', row.attempt_id, {
        days,
      });
    });
  }
}

export function startWorker(): NodeJS.Timeout {
  console.log('Re-assessment worker started (5s poll)');
  const timer = setInterval(() => {
    void tick();
  }, 5000);

  // Run once shortly after boot and then daily; dedupe happens in staleSweep.
  const sweep = () => {
    void staleSweep().catch((error) => console.error('Stale sweep failed', error));
  };
  setTimeout(sweep, 10_000);
  setInterval(sweep, 24 * 60 * 60 * 1000).unref();

  return timer;
}
