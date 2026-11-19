import { readFile } from 'node:fs/promises';
import { database, prisma } from './index';
import { createAssignment, createQuestion, publishAssignment, type Actor } from '@tuheng/domain';
import { uploadAsset } from '../../infrastructure/src/assets';

export async function seedResourceDemo() {
  const title = '点的三面投影 · 资源归档演示';
  const user = await prisma.user.findUniqueOrThrow({ where: { id: 'teacher' } });
  const actor: Actor = {
    id: user.id,
    name: user.name,
    roles: ['TEACHER'],
    kind: 'TEACHER',
    schoolId: 'school-demo',
  };
  if (await prisma.assignment.findFirst({ where: { creatorId: user.id, title } })) return;
  const asset = await uploadAsset(actor, {
    target: { kind: 'QUESTION' },
    file: {
      name: '投影练习.png',
      bytes: await readFile(new URL('../../../tests/samples/projection.png', import.meta.url)),
    },
  });
  const version = await createQuestion(database, actor, {
    title,
    content: '观察投影图，核对长对正、高平齐和宽相等。',
    chapter: '演示',
    type: 'POINT_PROJECTION',
    knowledgeIds: ['point'],
    assetIds: [asset.id],
    confirmed: true,
    reference: {
      version: 'demo-reference-1',
      content: '三个投影应符合长对正、高平齐、宽相等。',
      assetIds: [],
      verified: true,
      source: 'TEACHER',
    },
    rubric: {
      version: 'demo-rubric-1',
      maxPoints: 100,
      items: [
        {
          id: 'alignment',
          name: '投影对应',
          maxPoints: 100,
          knowledgeIds: ['point'],
          correctness: '三面投影关系正确',
          partialCredit: '按正确关系给相应分数',
          deductions: '同一原因的错误仅扣一次',
          deductionCap: null,
        },
      ],
    },
  });
  const now = new Date();
  const assignment = await createAssignment(database, actor, {
    classId: 'class-demo',
    title,
    questionVersionIds: [version.id],
    startsAt: now,
    dueAt: new Date(+now + 3 * 24 * 3600_000),
    allowLate: false,
    maxAttempts: 2,
    releaseAnswers: false,
  });
  await publishAssignment(database, actor, assignment.id);
  console.log('Resource demo ready. The Worker will archive its attachment.');
}
