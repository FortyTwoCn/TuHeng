import { resetIdentityFixtureThrottle } from '../identity-fixture';
import { spawnSync } from 'node:child_process';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createServer, type Server } from 'node:http';
import { prisma, database as db } from '@tuheng/database';
import { GradingRequest, AISnapshot } from '@tuheng/contracts';
import {
  createQuestion,
  createAssignment,
  publishAssignment,
  submitAnswer,
  planAIInvocation,
  type Actor,
} from '@tuheng/domain';
import { aiFixture } from '../ai-fixture';
import { requestFixture } from '../fixtures';
import { invocationProvider } from '../../packages/infrastructure/src/ai-gateway';
import { reserveAIBudget } from '../../packages/infrastructure/src/ai-budget';
import { saveAIConfiguration, aiCenter } from '../../packages/infrastructure/src/ai-admin';
import { reauthenticate } from '../../packages/infrastructure/src/identity-security';
import { loadIdentity } from '../../packages/infrastructure/src/identity-auth';
import { retryRun, rerunCurrentConfig } from '../../packages/infrastructure/src/admin';
import { executeGradingRun } from '../../packages/infrastructure/src/grading-runner';
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
      expect(input.model).toBe('test-model');
      received++;
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          model: 'test-model',
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
    offering = await prisma.courseOffering.create({ data: { courseId: course.id, term: tag } });
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
    await prisma.storedAsset.create({
      data: {
        ownerId: student.id,
        name: 'metadata-only.png',
        mime: 'image/png',
        bytes: 1,
        purpose: 'SUBMISSION',
        objectKey: `test-not-loaded/${tag}`,
      },
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
    it('AI02/03: controlled retry selects one immutable snapshot; raw credentials never appear in it or safe admin data', async () => {
      await fixture.bind('grading.assignment');
      await retryRun(root, runId);
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
    it('AI05: changes create versions; old snapshot stays fixed; new configuration rerun creates new record', async () => {
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
      const next = await rerunCurrentConfig(root, runId);
      expect(next.id).not.toBe(runId);
      expect(
        AISnapshot.parse(
          (await prisma.aIInvocation.findUniqueOrThrow({ where: { runId: next.id } })).snapshot,
        ).model.model,
      ).toBe('changed-model');
    });
    it('AI06: revoked old key and disabled provider block historical retry without request; teacher cannot edit AI config', async () => {
      await saveAIConfiguration(root, {
        operation: 'revoke-key',
        providerId: fixture.provider.id,
        secretId: fixture.secret.id,
        proof,
      });
      const inv = await prisma.aIInvocation.findUniqueOrThrow({ where: { runId } });
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
      expect(received).toBe(1);
    });
  },
);
