import type pg from 'pg';
import type { Snapshot } from '@hi/shared';

/**
 * Materialise an immutable snapshot into the per-candidate round graph.
 * Once an attempt exists the rows are never edited: a new version means a
 * new round, so historical attempts keep their exact questions.
 */
export async function cloneSnapshotToRound(
  client: pg.PoolClient,
  roundId: number,
  snapshot: Snapshot,
): Promise<void> {
  for (const level of snapshot.levels) {
    const levelRow = await client.query<{ id: number }>(
      `INSERT INTO assessment_levels (round_id, level_number, title)
       VALUES ($1, $2, $3) RETURNING id`,
      [roundId, level.levelNumber, level.title ?? null],
    );
    const levelId = levelRow.rows[0]!.id;
    for (const question of level.questions) {
      await client.query(
        `INSERT INTO assessment_questions
           (level_id, question_key, question_text, question_type, options, answer_key, marks, sequence_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          levelId,
          question.questionKey,
          question.questionText,
          question.questionType,
          question.options ? JSON.stringify(question.options) : null,
          question.answerKey ?? null,
          question.marks,
          question.sequenceOrder,
        ],
      );
    }
  }
}
