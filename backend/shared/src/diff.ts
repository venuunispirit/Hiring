import type { Question, Snapshot } from './schemas';

export type SnapshotDiff = {
  added: string[];
  removed: string[];
  changed: string[];
};

/** Content identity for a stable question key. Sequence/order edits do not force a re-ask. */
export function questionSignature(question: Question): string {
  const { sequenceOrder: _order, ...rest } = question;
  return JSON.stringify(rest);
}

export function flattenSnapshot(snapshot: Snapshot): Map<string, string> {
  const map = new Map<string, string>();
  for (const level of snapshot.levels) {
    for (const question of level.questions) {
      map.set(question.questionKey, questionSignature(question));
    }
  }
  return map;
}

/** Stable question keys make a version diff a set comparison, not guesswork. */
export function diffSnapshots(previous: Snapshot, next: Snapshot): SnapshotDiff {
  const before = flattenSnapshot(previous);
  const after = flattenSnapshot(next);
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  for (const key of after.keys()) {
    if (!before.has(key)) added.push(key);
    else if (before.get(key) !== after.get(key)) changed.push(key);
  }
  for (const key of before.keys()) {
    if (!after.has(key)) removed.push(key);
  }
  return { added, removed, changed };
}

export function totalMarks(snapshot: Snapshot): number {
  return snapshot.levels.reduce(
    (sum, level) => sum + level.questions.reduce((s, q) => s + q.marks, 0),
    0,
  );
}
