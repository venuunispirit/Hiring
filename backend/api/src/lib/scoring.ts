import type { QuestionType } from '@hi/shared';

const normalize = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : String(value ?? '').trim().toLowerCase();

/**
 * Objective answers only. Descriptive/coding/practical stay null until a
 * mentor scores them — automation must never overwrite a human score.
 */
export function autoScore(
  type: QuestionType,
  answerKey: string | null,
  answer: unknown,
  marks: number,
): number | null {
  if (answerKey == null) return null;
  if (type === 'descriptive' || type === 'coding' || type === 'practical') return null;
  if (answer === null || answer === undefined || answer === '') return 0;

  if (type === 'multiple_select') {
    const expected = new Set(
      answerKey.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    );
    const actual = new Set(
      (Array.isArray(answer) ? answer : [answer]).map((v) => normalize(v)),
    );
    if (expected.size !== actual.size) return 0;
    for (const value of expected) if (!actual.has(value)) return 0;
    return marks;
  }

  return normalize(answer) === normalize(answerKey) ? marks : 0;
}

export function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}
