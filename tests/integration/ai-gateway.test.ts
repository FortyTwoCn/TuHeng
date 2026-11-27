import { resetIdentityFixtureThrottle } from '../identity-fixture';
import { spawnSync } from 'node:child_process';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createServer, type Server } from 'node:http';
import { prisma, database as db } from '@tuheng/database';
import { GradingRequest, AISnapshot, AIModelConfig, AITaskParameters } from '@tuheng/contracts';
import {
  createQuestion,
  createAssignment,
  publishAssignment,
  submitAnswer,
  planAIInvocation,
  type Actor,
} from '@tuheng/domain';
import { aiFixture } from '../ai-fixture';
import { activeTermRange, requestFixture } from '../fixtures';
import { invocationProvider } from '../../packages/infrastructure/src/ai-gateway';
import { reserveAIBudget } from '../../packages/infrastructure/src/ai-budget';
import { saveAIConfiguration, aiCenter } from '../../packages/infrastructure/src/ai-admin';
import { reauthenticate } from '../../packages/infrastructure/src/identity-security';
import { loadIdentity } from '../../packages/infrastructure/src/identity-auth';
import { retryRun, rerunCurrentConfig } from '../../packages/infrastructure/src/admin';
import { executeGradingRun } from '../../packages/infrastructure/src/grading-runner';
import { listGradingJobs } from '../../packages/infrastructure/src/job-records';
import { listAIInvocations } from '../../packages/infrastructure/src/ai-records';
import { uploadAsset } from '@tuheng/infrastructure';
import { readFile } from 'node:fs/promises';
const tag = crypto.randomUUID();
let server: Server,
  fixture: Awaited<ReturnType<typeof aiFixture>>,
  root: Actor,
  proof: string,
  teacher: Actor,
  student: Actor,
  runId: string,
  itemId: string,
  assetId: string,
  snapshot: AISnapshot;
let received = 0;
beforeAll(async () => {
  await resetIdentityFixtureThrottle();
  process.env.QUEUE_NAMESPACE = `ai-${tag}`;
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', () => {
      const input = JSON.parse(body);
      expect(req.url).toBe('/v1/chat/completions');
      expect(['test-model', 'different-selftest-model']).toContain(input.model);
      received++;
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          model: input.model,
          choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }],
          usage: { prompt_tokens: 7, completion_tokens: 3 },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  process.env.TUHENG_OUTBOUND_ALLOWLIST = `127.0.0.1:${port}`;
  fixture = await aiFixture(`http://127.0.0.1:${port}/v1`);
  await fixture.bind('grading.assignment', false);
  const rootRow = await prisma.user.findUniqueOrThrow({ where: { id: 'admin' } });
  root = await loadIdentity('admin', 'STAFF', rootRow.tokenVersion, false);
  proof = (await reauthenticate(root, process.env.SEED_PASSWORD!)).proof;
  const school = await prisma.school.create({ data: { code: `AI-${tag}`, name: 'AI scope test' } });
  for (const kind of ['TEACHER', 'STUDENT'] as const) {
    const u = await prisma.user.create({
      data: {
        name: kind,
        email: '',
        passwordHash: 'test-only',
        roles: [kind],
        kind,
        realm: kind === 'STUDENT' ? 'STUDENT' : 'STAFF',
        schoolId: school.id,
        mustChangePassword: false,
      },
    });
    const a: Actor = { id: u.id, name: u.name, roles: [kind], kind, schoolId: school.id };
    if (kind === 'TEACHER') teacher = a;
    else student = a;
  }
  const course = await prisma.course.create({
      data: { code: tag, title: '测试', schoolId: school.id },
    }),
    offering = await prisma.courseOffering.create({
      data: { courseId: course.id, term: tag, ...activeTermRange() },
    });
  const cls = await prisma.teachingClass.create({
    data: {
      schoolId: school.id,
      name: '一班',
      offeringId: offering.id,
      grants: { create: { userId: teacher.id } },
      enrollments: { create: { userId: student.id } },
    },
  });
  const f = requestFixture();
  const q = await createQuestion(db, teacher, {
    title: 'AI test',
    content: f.question.content,
    type: f.question.type,
    chapter: '',
    knowledgeIds: [],
    assetIds: [],
    reference: f.reference,
    rubric: { ...f.rubric, items: f.rubric.items.map((i) => ({ ...i, knowledgeIds: [] })) },
    confirmed: true,
  });
  const assignment = await createAssignment(db, teacher, {
    title: 'AI blocked submission',
    classId: cls.id,
    questionVersionIds: [q.id],
    startsAt: new Date(Date.now() - 1000),
    dueAt: new Date(Date.now() + 86400000),
    allowLate: false,
    maxAttempts: 10,
    releaseAnswers: false,
  });
  await publishAssignment(db, teacher, assignment.id);
  itemId = (
    await prisma.assignmentItem.findFirstOrThrow({ where: { assignmentId: assignment.id } })
  ).id;
  assetId = (
    await uploadAsset(student, {
      file: { name: 'fixture.png', bytes: await readFile('tests/samples/projection.png') },
      target: { kind: 'ASSIGNMENT_ANSWER', itemId },
    })
  ).id;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const { queueFor } = await import('@tuheng/infrastructure');
  for (const lane of ['formal', 'selftest']) {
    const q = queueFor(lane);
    await q.obliterate({ force: true });
    await q.close();
  }
  await prisma.$disconnect();
});
describe.sequential(
  'database AI plans + real local HTTP protocol substitute + shared Redis budgets',
  () => {
    it('AI01: no active task binding preserves valid submission and creates explicit blocked run; legacy env does not activate a model', async () => {
      process.env.AI_API_KEY = 'test-env-must-not-be-used';
      process.env.AI_MODEL = 'forbidden-env-fallback';
      const a = await submitAnswer(db, student, {
        itemId,
        assetIds: [assetId],
        idempotencyKey: crypto.randomUUID(),
      });
      const run = await prisma.gradingRun.findFirstOrThrow({ where: { attemptId: a.id } });
      runId = run.id;
      expect(run.status).toBe('BLOCKED_CONFIG');
      expect(run.configId).toBeNull();
      expect(run.errorCode).toBe('AI_BINDING_NOT_CONFIGURED');
      expect(a.submittedAt).toBeTruthy();
      expect(received).toBe(0);
    });
    it('AI02/03/T02: missing snapshots require a new run; explicit retry keeps an immutable snapshot and credentials stay private', async () => {
      await fixture.bind('grading.assignment');
      const blockedId = runId;
      await expect(retryRun(root, blockedId)).rejects.toThrow('AI_SNAPSHOT_REQUIRED');
      const fresh = await rerunCurrentConfig(root, blockedId);
      runId = fresh.id;
      expect((await prisma.gradingRun.findUniqueOrThrow({ where: { id: blockedId } })).status).toBe(
        'BLOCKED_CONFIG',
      );
      const inv = await prisma.aIInvocation.findUniqueOrThrow({ where: { runId } });
      snapshot = AISnapshot.parse(inv.snapshot);
      expect(snapshot.model.model).toBe('test-model');
      expect(JSON.stringify(snapshot)).not.toContain('test-credential-not-for-real-provider');
      expect(JSON.stringify(await aiCenter(root))).not.toContain(
        'test-credential-not-for-real-provider',
      );
      const r = await (
        await invocationProvider(inv.id)
      ).evaluate({ system: 's', user: 'test', images: [], schema: { type: 'object' } });
      expect(r.data).toEqual({ ok: true });
      expect(received).toBe(1);
      expect(
        (await prisma.aIInvocation.findUniqueOrThrow({ where: { id: inv.id } })).inputTokens,
      ).toBe(7);
      const plan = await planAIInvocation(db, 'grading.assignment', requestFixture());
      expect(plan.snapshot?.required.images).toBe(true);
    });
    it('AI04: provider concurrency is shared, release enables the next caller', async () => {
      const release = await reserveAIBudget(snapshot, student.id, student.schoolId!);
      try {
        await expect(
          reserveAIBudget(snapshot, student.id, student.schoolId!),
        ).rejects.toMatchObject({ code: 'AI_CONCURRENCY_LIMIT' });
      } finally {
        await release();
      }
      await (
        await reserveAIBudget(snapshot, student.id, student.schoolId!)
      )();
    });
    it('AI05/T02: changes create versions; old snapshot stays fixed; new configuration rerun creates new record', async () => {
      const priorRun = await prisma.gradingRun.findUniqueOrThrow({ where: { id: runId } });
      const official = await prisma.gradeDecision.create({
        data: {
          attemptId: priorRun.attemptId,
          teacherId: teacher.id,
          revision: 1,
          points: 35,
          items: [],
          feedback: 'Published teacher fixture',
          annotations: [],
          publishedAt: new Date(),
        },
      });
      await prisma.submissionAttempt.update({
        where: { id: priorRun.attemptId },
        data: { publishedDecisionId: official.id },
      });
      await prisma.gradingRun.update({ where: { id: runId }, data: { status: 'FAILED' } });
      await prisma.backgroundJob.update({ where: { runId }, data: { status: 'FAILED' } });
      const retryId = crypto.randomUUID();
      await Promise.all([retryRun(root, runId, retryId), retryRun(root, runId, retryId)]);
      expect(await prisma.auditLog.count({ where: { id: retryId } })).toBe(1);
      expect((await prisma.aIInvocation.findUniqueOrThrow({ where: { runId } })).snapshot).toEqual(
        snapshot,
      );
      await prisma.gradingRun.update({ where: { id: runId }, data: { status: 'FAILED' } });
      await retryRun(root, runId, retryId);
      expect((await prisma.gradingRun.findUniqueOrThrow({ where: { id: runId } })).status).toBe(
        'FAILED',
      );
      await expect(retryRun(root, runId, crypto.randomUUID())).rejects.toThrow(
        'RUN_QUEUE_NOT_TERMINAL',
      );
      expect((await prisma.gradingRun.findUniqueOrThrow({ where: { id: runId } })).status).toBe(
        'FAILED',
      );
      await saveAIConfiguration(root, {
        operation: 'model',
        id: fixture.model.id,
        providerId: fixture.provider.id,
        name: 'renamed model',
        enabled: true,
        archived: false,
        expectedVersion: 1,
        proof,
        config: { ...snapshot.model, model: 'changed-model' },
      });
      expect(
        AISnapshot.parse(
          (await prisma.aIInvocation.findUniqueOrThrow({ where: { runId } })).snapshot,
        ).model.model,
      ).toBe('test-model');
      await prisma.gradingRun.update({ where: { id: runId }, data: { status: 'FAILED' } });
      const requestId = crypto.randomUUID();
      const [next, duplicate] = await Promise.all([
        rerunCurrentConfig(root, runId, requestId),
        rerunCurrentConfig(root, runId, requestId),
      ]);
      expect(next.id).toBe(duplicate.id);
      expect(await prisma.backgroundJob.count({ where: { runId: next.id } })).toBe(1);
      expect(
        await prisma.auditLog.count({
          where: { action: 'RUN_NEW_CONFIGURATION', resourceId: next.id },
        }),
      ).toBe(1);
      expect(
        (await prisma.submissionAttempt.findUniqueOrThrow({ where: { id: priorRun.attemptId } }))
          .publishedDecisionId,
      ).toBe(official.id);
      expect(await prisma.gradeDecision.findUnique({ where: { id: official.id } })).toEqual(
        official,
      );
      expect((await prisma.gradingRun.findUniqueOrThrow({ where: { id: runId } })).request).toEqual(
        priorRun.request,
      );
      expect(next.id).not.toBe(runId);
      expect(
        AISnapshot.parse(
          (await prisma.aIInvocation.findUniqueOrThrow({ where: { runId: next.id } })).snapshot,
        ).model.model,
      ).toBe('changed-model');
    });
    it('T01: task pagination and scoped counts use all matching rows and expose only safe metadata', async () => {
      const original = await prisma.gradingRun.findUniqueOrThrow({ where: { id: runId } });
      for (let i = 0; i < 33; i++) {
        const id = crypto.randomUUID();
        await prisma.gradingRun.create({
          data: {
            id,
            attemptId: original.attemptId,
            status: i === 32 ? 'RUNNING' : 'FAILED',
            strategyVersion: original.strategyVersion,
            promptVersion: original.promptVersion,
            request: { ...GradingRequest.parse(original.request), runId: id },
            createdAt: new Date('2026-01-02T12:00:00Z'),
            job: {
              create: {
                lane: 'formal',
                status: i === 32 ? 'RUNNING' : 'FAILED',
                errorCode: 'unsafe legacy diagnostic must stay private',
              },
            },
          },
        });
      }
      const filters = {
        page: 0,
        schoolId: student.schoolId!,
        status: 'FAILED' as const,
        from: '2026-01-02T00:00:00Z',
        to: '2026-01-03T00:00:00Z',
      };
      const first = await listGradingJobs(root, filters),
        last = await listGradingJobs(root, { ...filters, page: 1 });
      expect(first.total).toBe(32);
      expect(first.counts).toEqual([{ status: 'FAILED', count: 32 }]);
      expect(first.items).toHaveLength(30);
      expect(last.items).toHaveLength(2);
      expect(new Set([...first.items, ...last.items].map((j) => j.id)).size).toBe(32);
      expect(first.items[0].actions.retryOriginal).toEqual({
        allowed: false,
        reason: 'AI_SNAPSHOT_REQUIRED',
      });
      expect(first.items[0].actions.newCurrent.allowed).toBe(true);
      expect(first.items[0].officialGradePublished).toBe(true);
      expect(first.items[0].errorCode).toBe('DIAGNOSTIC_UNAVAILABLE');
      expect(JSON.stringify(first)).not.toMatch(
        /secretId|ciphertext|rawResponse|geometryAnswer|unsafe legacy|test-credential/,
      );
      expect((await listGradingJobs(root, { page: 0, q: last.items[0].runId })).total).toBe(1);
      const operator = await listGradingJobs(
        { ...root, kind: 'TEACHER', roles: ['PLATFORM_OPERATOR'] },
        filters,
      );
      expect(operator.total).toBe(32);
      expect(operator.items[0].actions.retryOriginal).toEqual({
        allowed: false,
        reason: 'FORBIDDEN',
      });
      expect(operator.items[0].actions.newCurrent.allowed).toBe(false);
      await expect(listGradingJobs(student, { page: 0 })).rejects.toMatchObject({ status: 403 });
    });
    it('AI06: revoked old key and disabled provider block historical retry without request; teacher cannot edit AI config', async () => {
      await saveAIConfiguration(root, {
        operation: 'revoke-key',
        providerId: fixture.provider.id,
        secretId: fixture.secret.id,
        proof,
      });
      const inv = await prisma.aIInvocation.findUniqueOrThrow({ where: { runId } });
      await expect(retryRun(root, runId, crypto.randomUUID())).rejects.toThrow(
        'AI_CREDENTIAL_UNAVAILABLE',
      );
      await expect(
        (await invocationProvider(inv.id)).evaluate({
          system: 's',
          user: 'u',
          images: [],
          schema: {},
        }),
      ).rejects.toMatchObject({ code: 'AI_CREDENTIAL_UNAVAILABLE' });
      expect(received).toBe(1);
      await prisma.aIProvider.update({
        where: { id: fixture.provider.id },
        data: { enabled: false },
      });
      await expect(
        (await invocationProvider(inv.id)).evaluate({
          system: 's',
          user: 'u',
          images: [],
          schema: {},
        }),
      ).rejects.toMatchObject({ code: 'AI_PROVIDER_DISABLED' });
      await expect(
        saveAIConfiguration(teacher, {
          operation: 'revoke-key',
          providerId: fixture.provider.id,
          secretId: fixture.secret.id,
          proof,
        }),
      ).rejects.toMatchObject({ status: 403 });
    });
    it('AI08: explicit legacy import encrypts once, stays disabled and never invokes a provider', async () => {
      const provider = await prisma.aIProviderVersion.findFirstOrThrow({
        where: { providerId: fixture.provider.id },
        orderBy: { version: 'desc' },
      });
      const legacy = await prisma.modelConfigurationVersion.create({
        data: {
          provider: 'migration-fixture',
          baseUrl: (provider.config as { baseUrl: string }).baseUrl,
          model: 'migration-only',
          outputMode: 'prompt_json',
          timeoutMs: 10000,
          concurrency: 1,
          keyEnv: 'AI_MIGRATION_TEST_KEY',
        },
      });
      const env = { ...process.env, AI_MIGRATION_TEST_KEY: 'migration-test-key-local-only' };
      const args = [
        '--import',
        'tsx',
        'scripts/ai-import-environment.ts',
        '--legacy-id',
        legacy.id,
        '--protocol',
        'OPENAI_CHAT_COMPLETIONS',
        '--confirm-import',
      ];
      const first = spawnSync(process.execPath, args, { env, encoding: 'utf8', windowsHide: true });
      expect(first.status, first.stderr).toBe(0);
      const output = JSON.parse(first.stdout);
      expect(output.enabled).toBe(false);
      expect(output.credentialImported).toBe(true);
      expect(first.stdout).not.toContain(env.AI_MIGRATION_TEST_KEY);
      const p = await prisma.aIProvider.findUniqueOrThrow({
        where: { id: output.providerId },
        include: { versions: true },
      });
      const secret = await prisma.secretRecord.findUniqueOrThrow({
        where: { id: p.versions[0].secretId! },
      });
      expect(secret.ciphertext).not.toContain(env.AI_MIGRATION_TEST_KEY);
      const again = spawnSync(process.execPath, args, { env, encoding: 'utf8', windowsHide: true });
      expect(again.status).not.toBe(0);
      expect(again.stderr).toContain('LEGACY_AI_ALREADY_IMPORTED');
      expect(
        await prisma.auditLog.count({
          where: { resourceId: legacy.id, action: 'LEGACY_AI_IMPORTED' },
        }),
      ).toBe(1);
      expect(received).toBe(1);
    });
    it('A06: invocation filters page the same scope and only expose safe diagnostic fields', async () => {
      const actorId = 'invocation-filter-' + tag;
      await prisma.aIInvocation.createMany({
        data: Array.from({ length: 33 }, (_, i) => ({
          actorId,
          resourceId: tag,
          taskKey: 'admin.model-test',
          status: i === 32 ? 'SUCCEEDED' : 'FAILED',
          snapshot: JSON.parse(JSON.stringify(snapshot)),
          createdAt: new Date('2026-02-01T12:00:00Z'),
        })),
      });
      const filters = {
        page: 0,
        actorId,
        providerId: snapshot.providerId,
        status: 'FAILED',
        from: '2026-02-01T00:00:00Z',
        to: '2026-02-02T00:00:00Z',
      };
      const first = await listAIInvocations(root, filters),
        second = await listAIInvocations(root, { ...filters, page: 1 });
      expect(first.total).toBe(32);
      expect(first.items).toHaveLength(30);
      expect(second.items).toHaveLength(2);
      expect(new Set([...first.items, ...second.items].map((i) => i.id)).size).toBe(32);
      expect(first.items[0]).toMatchObject({
        inputTokens: null,
        outputTokens: null,
        estimatedCost: null,
      });
      expect(JSON.stringify(first.items)).not.toMatch(
        /secretId|ciphertext|test-credential|baseUrl/,
      );
      expect(
        (await listAIInvocations(root, { ...filters, from: '2026-02-02T00:00:00Z' })).total,
      ).toBe(0);
      await expect(listAIInvocations(student, filters)).rejects.toMatchObject({ status: 403 });
      expect(received).toBe(1);
    });
    it('A04: assignment and selftest bindings issue real local protocol requests to distinct configured models', async () => {
      const port = (server.address() as { port: number }).port;
      const independent = await aiFixture('http://127.0.0.1:' + port + '/v1');
      await independent.bind('grading.assignment');
      const secondModel = await prisma.aIModel.create({
        data: {
          providerId: independent.provider.id,
          name: '[TEST] independent selftest model',
          enabled: true,
          versions: {
            create: {
              version: 1,
              config: AIModelConfig.parse({
                model: 'different-selftest-model',
                images: true,
                outputModes: ['prompt_json'],
              }),
              testStatus: {},
            },
          },
        },
      });
      const previous = await prisma.aITaskBindingVersion.findFirst({
        where: { taskKey: 'grading.selftest' },
        orderBy: { version: 'desc' },
      });
      await prisma.aITaskBindingVersion.create({
        data: {
          taskKey: 'grading.selftest',
          version: (previous?.version ?? 0) + 1,
          modelId: secondModel.id,
          enabled: true,
          parameters: AITaskParameters.parse({ outputMode: 'prompt_json' }),
        },
      });
      const before = received,
        models: string[] = [];
      for (const key of ['grading.assignment', 'grading.selftest'] as const) {
        const plan = await planAIInvocation(db, key, requestFixture());
        expect(plan.errorCode).toBeNull();
        models.push(plan.snapshot!.model.model);
        const invocation = await prisma.aIInvocation.create({
          data: {
            taskKey: key,
            actorId: student.id,
            schoolId: student.schoolId,
            resourceId: tag,
            snapshot: JSON.parse(JSON.stringify(plan.snapshot)),
            status: 'QUEUED',
          },
        });
        const result = await (
          await invocationProvider(invocation.id)
        ).evaluate({ system: 's', user: 'u', images: [], schema: { type: 'object' } });
        expect(result.data).toEqual({ ok: true });
      }
      expect(models).toEqual(['test-model', 'different-selftest-model']);
      expect(received - before).toBe(2);
      // Restore blocked routing used by legacy compatibility checks; no worker uses this fixture.
      await independent.bind('grading.assignment', false);
      await prisma.aIProvider.update({
        where: { id: independent.provider.id },
        data: { enabled: false },
      });
    });
    it('AI07: old serialized request remains readable; legacy run never falls back to environment key', async () => {
      const prior = await prisma.gradingRun.findUniqueOrThrow({ where: { id: runId } });
      expect(GradingRequest.safeParse(prior.request).success).toBe(true);
      const legacy = await prisma.gradingRun.create({
        data: {
          attemptId: prior.attemptId,
          configId: null,
          status: 'QUEUED',
          request: prior.request!,
          strategyVersion: prior.strategyVersion,
          promptVersion: prior.promptVersion,
        },
      });
      await prisma.backgroundJob.create({ data: { runId: legacy.id, lane: 'formal' } });
      await executeGradingRun(legacy.id);
      expect(
        (await prisma.gradingRun.findUniqueOrThrow({ where: { id: legacy.id } })).errorCode,
      ).toBe('AI_LEGACY_CONFIGURATION_REQUIRED');
      expect(received).toBe(3);
    });
  },
);
