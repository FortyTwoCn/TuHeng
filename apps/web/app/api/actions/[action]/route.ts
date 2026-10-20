import { z } from 'zod';
import { database, prisma } from '@tuheng/database';
import * as domain from '@tuheng/domain';
import * as infra from '@tuheng/infrastructure';
import { actor } from '../../../../lib/auth';
import { checkOrigin, errorResponse, limitedBody } from '../../../../lib/http';
const id = z.string().min(1).max(200),
  title = z.string().min(1).max(200);
export const runtime = 'nodejs';
export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  try {
    checkOrigin(request);
    const a = await actor();
    const { action } = await params;
    const body = JSON.parse((await limitedBody(request, 150000)).toString());
    let result: unknown;
    switch (action) {
      case 'question': {
        const p = z.object({ question: z.unknown(), questionId: id.optional() }).parse(body);
        result = await domain.createQuestion(database, a, p.question, false, p.questionId);
        break;
      }
      case 'question-disable': {
        const p = z.object({ id }).parse(body);
        domain.requireRole(a, 'TEACHER');
        const q = await database.get('question', p.id);
        domain.ensure(q?.ownerId === a.id, 'FORBIDDEN', 403);
        result = await database.transaction(async (tx) => {
          const v = await tx.update('question', p.id, { active: false });
          await domain.audit(tx, a, 'QUESTION_DISABLED', p.id);
          return v;
        });
        break;
      }
      case 'assignment': {
        const p = z
          .object({
            title,
            classId: id,
            questionVersionIds: z.array(id).min(1).max(50),
            startsAt: z.coerce.date(),
            dueAt: z.coerce.date(),
            allowLate: z.boolean(),
            maxAttempts: z.number().int().min(1).max(10),
            releaseAnswers: z.boolean(),
          })
          .parse(body);
        result = await domain.createAssignment(database, a, p);
        break;
      }
      case 'assignment-publish':
        result = await domain.publishAssignment(database, a, z.object({ id }).parse(body).id);
        break;
      case 'draft': {
        const p = z.object({ itemId: id, assetIds: z.array(id).max(10) }).parse(body);
        result = await domain.saveDraft(database, a, p.itemId, p.assetIds);
        break;
      }
      case 'submit': {
        const p = z
          .object({
            itemId: id.optional(),
            selfTestItemId: id.optional(),
            reviewEntryId: id.optional(),
            assetIds: z.array(id).max(10),
            idempotencyKey: z.string().uuid(),
          })
          .parse(body);
        result = await domain.submitAnswer(
          database,
          a,
          p,
          Number(process.env.SELFTEST_DAILY_QUOTA ?? 20),
        );
        break;
      }
      case 'review':
        result = await domain.reviewGrade(database, a, body);
        break;
      case 'roster-import': {
        const p = z.object({ classId: id, emails: z.array(z.email()).min(1).max(200) }).parse(body);
        result = await domain.importRoster(database, a, p.classId, p.emails);
        break;
      }
      case 'grades-publish-batch': {
        const p = z.object({ ids: z.array(id).min(1).max(100) }).parse(body);
        result = await database.transaction(async (tx) => {
          const decisions = [];
          for (const id of p.ids) decisions.push(await domain.publishGrade(tx, a, id));
          return decisions;
        });
        break;
      }
      case 'grade-publish':
        result = await domain.publishGrade(database, a, z.object({ id }).parse(body).id);
        break;
      case 'appeal': {
        const p = z.object({ attemptId: id, reason: z.string().min(5).max(4000) }).parse(body);
        result = await domain.appealGrade(database, a, p.attemptId, p.reason);
        break;
      }
      case 'appeal-resolve': {
        const p = z.object({ id, response: z.string().min(3).max(4000) }).parse(body);
        result = await domain.resolveAppeal(database, a, p.id, p.response);
        break;
      }
      case 'folder':
        result = await domain.createFolder(database, a, z.object({ title }).parse(body).title);
        break;
      case 'selftest':
        result = await domain.createSelfTest(
          database,
          a,
          z
            .object({
              title,
              folderId: id.nullable(),
              mode: z.enum(['QUESTION_ONLY', 'COMBINED', 'SEPARATE']),
              question: z.unknown(),
            })
            .parse(body),
        );
        break;
      case 'error-collect':
        result = await domain.collectError(
          database,
          a,
          z.object({ attemptId: id }).parse(body).attemptId,
        );
        break;
      case 'errors-archive':
        result = await domain.archiveErrors(
          database,
          a,
          z.object({ ids: z.array(id).max(100) }).parse(body).ids,
        );
        break;
      case 'user-create':
        result = await infra.createUser(
          a,
          z
            .object({
              email: z.email(),
              name: title,
              password: z.string().min(12).max(200),
              roles: z.array(z.string()).min(1),
            })
            .parse(body),
        );
        break;
      case 'user-update': {
        const p = z
          .object({
            id,
            active: z.boolean().optional(),
            roles: z.array(z.string()).min(1).optional(),
            password: z.string().min(12).max(200).optional(),
          })
          .parse(body);
        result = await infra.updateUser(a, p.id, p);
        break;
      }
      case 'run-retry':
        result = await infra.retryRun(a, z.object({ id }).parse(body).id);
        break;
      case 'run-current-config':
        result = await infra.rerunCurrentConfig(a, z.object({ id }).parse(body).id);
        break;
      case 'model-test':
        result = await infra.testModel(a);
        break;
      case 'asset-transform': {
        const p = z
          .object({
            id,
            rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
            crop: z
              .object({ left: z.number(), top: z.number(), width: z.number(), height: z.number() })
              .nullable(),
          })
          .parse(body);
        result = await infra.transformAsset(a, p.id, {
          maxDimension: 2400,
          rotate: p.rotate,
          crop: p.crop,
        });
        break;
      }
      case 'organization': {
        domain.requireRole(a, 'ADMIN');
        const p = z
          .discriminatedUnion('kind', [
            z.object({ kind: z.literal('course'), code: title, title }),
            z.object({ kind: z.literal('offering'), courseId: id, term: title }),
            z.object({ kind: z.literal('class'), offeringId: id, name: title }),
            z.object({ kind: z.literal('enrollment'), userId: id, classId: id }),
            z.object({ kind: z.literal('grant'), userId: id, classId: id }),
          ])
          .parse(body);
        result = await database.transaction(async (tx) => {
          let row;
          if (p.kind === 'course')
            row = await tx.create('course', { code: p.code, title: p.title });
          else if (p.kind === 'offering')
            row = await tx.create('courseOffering', { courseId: p.courseId, term: p.term });
          else if (p.kind === 'class')
            row = await tx.create('teachingClass', { offeringId: p.offeringId, name: p.name });
          else if (p.kind === 'enrollment')
            row = await tx.create('enrollment', { userId: p.userId, classId: p.classId });
          else {
            const u = await tx.get('user', p.userId);
            domain.ensure(
              u &&
                domain.hasRole(
                  { id: u.id, name: u.name, roles: u.roles },
                  'TEACHER',
                  'TEACHING_ASSISTANT',
                ),
              'TEACHER_ROLE_REQUIRED',
            );
            row = await tx.create('teachingGrant', { userId: p.userId, classId: p.classId });
          }
          await domain.audit(tx, a, 'ORGANIZATION_CREATED', row.id, { kind: p.kind });
          return row;
        });
        break;
      }
      case 'export': {
        const p = z.object({ classId: id }).parse(body);
        await domain.requireClass(database, a, p.classId, true);
        const enrollments = await database.list('enrollment', { classId: p.classId });
        const assignments = await database.list('assignment', { classId: p.classId });
        const items = await database.list('assignmentItem', {
          assignmentId: { in: assignments.map((v) => v.id) },
        });
        const submissions = await database.list('submission', {
          itemId: { in: items.map((v) => v.id) },
        });
        const rows = [['学生', '作业', '题目', '提交版本', '提交时间', '正式成绩']];
        for (const s of submissions) {
          const user = await database.get('user', s.userId);
          const item = items.find((i) => i.id === s.itemId)!;
          const ass = assignments.find((v) => v.id === item.assignmentId)!;
          const q = await database.get('questionVersion', item.questionVersionId);
          for (const at of await database.list('submissionAttempt', { submissionId: s.id })) {
            const d = at.publishedDecisionId
              ? await database.get('gradeDecision', at.publishedDecisionId)
              : null;
            rows.push([
              user?.name ?? '',
              ass.title,
              q?.title ?? '',
              String(at.version),
              at.submittedAt.toISOString(),
              d ? String(d.points / 10) : '未发布',
            ]);
          }
        }
        await domain.audit(database, a, 'CLASS_EXPORTED', p.classId, {
          enrolled: enrollments.length,
        });
        const csv =
          '\uFEFF' +
          rows
            .map((r) =>
              r
                .map((s) => '"' + (/^[=+@\-]/.test(s) ? "'" + s : s).replaceAll('"', '""') + '"')
                .join(','),
            )
            .join('\r\n');
        return new Response(csv, {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': 'attachment; filename="tuheng-grades.csv"',
          },
        });
      }
      default:
        throw new domain.DomainError('UNKNOWN_ACTION', 404);
    }
    return Response.json({ ok: true, data: result });
  } catch (e) {
    return errorResponse(e);
  }
}
export async function GET(request: Request, { params }: { params: Promise<{ action: string }> }) {
  try {
    const a = await actor();
    const { action } = await params;
    if (action === 'model-status') return Response.json(await infra.modelStatus(a));
    if (action === 'health') {
      domain.requireRole(a, 'ADMIN', 'PLATFORM_OPERATOR');
      const checks = await Promise.allSettled([prisma.$queryRaw`SELECT 1`, infra.storageHealth()]);
      return Response.json({
        database: checks[0].status,
        storage: checks[1].status,
        now: new Date().toISOString(),
      });
    }
    throw new domain.DomainError('NOT_FOUND', 404);
  } catch (e) {
    return errorResponse(e);
  }
}
