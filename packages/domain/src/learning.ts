import type { Actor, DataPort } from './entities';
import { ensure, attemptContext, audit } from './policy';
import { createQuestion } from './teaching';
export async function createFolder(db: DataPort, a: Actor, title: string) {
  return db.create('selfTestFolder', { ownerId: a.id, title });
}
export async function createSelfTest(
  db: DataPort,
  a: Actor,
  input: { title: string; folderId: string | null; mode: string; question: unknown },
) {
  if (input.folderId)
    ensure(
      (await db.get('selfTestFolder', input.folderId))?.ownerId === a.id,
      'FOLDER_FORBIDDEN',
      403,
    );
  return db.transaction(async (tx) => {
    const question = await createQuestion(tx, a, input.question, true);
    const set = await tx.create('selfTestSet', {
      ownerId: a.id,
      title: input.title,
      folderId: input.folderId,
      mode: input.mode,
    });
    await tx.create('selfTestItem', { setId: set.id, questionVersionId: question.id, position: 0 });
    await audit(tx, a, 'SELFTEST_CREATED', set.id);
    return set;
  });
}
export async function collectError(db: DataPort, a: Actor, attemptId: string) {
  return db.transaction(async (tx) => {
    const { attempt } = await attemptContext(tx, a, attemptId);
    ensure(attempt.ownerId === a.id, 'FORBIDDEN', 403);
    const existing = (await tx.list('errorBookEntry', { ownerId: a.id, attemptId }))[0];
    if (existing) return tx.update('errorBookEntry', existing.id, { archived: false });
    return tx.create('errorBookEntry', {
      ownerId: a.id,
      attemptId,
      questionVersionId: attempt.questionVersionId,
    });
  });
}
export async function archiveErrors(db: DataPort, a: Actor, ids: string[]) {
  return db.transaction(async (tx) => {
    for (const id of ids) {
      const entry = await tx.get('errorBookEntry', id);
      ensure(entry?.ownerId === a.id, 'FORBIDDEN', 403);
      await tx.update('errorBookEntry', id, { archived: true });
    }
    await audit(tx, a, 'ERRORS_ARCHIVED', a.id, { count: ids.length });
    return { count: ids.length };
  });
}
