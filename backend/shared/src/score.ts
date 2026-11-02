/** Marks are NUMERIC(7,2); round to avoid float drift in scores. */
export function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}
