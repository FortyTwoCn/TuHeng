import { test, expect, type Page } from '@playwright/test';
import { requestFixture } from '../fixtures';
import { encryptSecret } from '../../packages/infrastructure/src/secret-store';
import { AIProviderConfig, AIModelConfig, AITaskParameters } from '@tuheng/contracts';
import { prisma } from '@tuheng/database';
import { prepareLogin } from './identity-login';

async function loginRoot(page: Page) {
  const identifier = await prepareLogin(page, 'admin');
  await identifier.fill('admin@tuheng.local');
  await page.getByLabel('密码', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL('/admin/dashboard');
}

test('A01/A05: configuration lists protect a draft, keep secret input local, and return to a filtered mobile list', async ({
  page,
}) => {
  await loginRoot(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const existingName = 'Browser provider draft-' + Date.now();
  await prisma.aIProvider.create({
    data: {
      name: existingName,
      brand: 'UI regression',
      enabled: false,
      currentVersion: 1,
      versions: {
        create: {
          version: 1,
          config: AIProviderConfig.parse({
            baseUrl: 'https://example.test/v1',
            protocol: 'OPENAI_CHAT_COMPLETIONS',
          }),
        },
      },
    },
  });
  await page.goto('/admin/models');
  await page.getByRole('button', { name: '新增供应商', exact: true }).click();
  await page.getByLabel('显示名称', { exact: true }).fill('尚未保存的供应商');
  await page.getByLabel('API Key（留空保持原值）', { exact: true }).fill('only-this-draft');
  await page.getByRole('button', { name: '模型目录', exact: true }).click();
  const guard = page.getByRole('dialog', { name: '未保存的配置', exact: true });
  await expect(guard).toBeVisible();
  await guard.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(page.getByLabel('显示名称', { exact: true })).toHaveValue('尚未保存的供应商');
  await page.getByRole('button', { name: '显示API Key（留空保持原值）', exact: true }).click();
  await expect(page.getByLabel('API Key（留空保持原值）', { exact: true })).toHaveAttribute(
    'type',
    'text',
  );
  await page.getByRole('button', { name: '返回列表', exact: true }).click();
  await guard.getByRole('button', { name: '丢弃修改并切换', exact: true }).click();
  await page.getByLabel('搜索供应商', { exact: true }).fill(existingName);
  const first = page.locator('.configuration-list [data-record-id]').first();
  await first.click();
  await expect(page.getByLabel('API Key（留空保持原值）', { exact: true })).toHaveValue('');
  await page.screenshot({
    path: '.runtime/ui-redesign/evidence/ai-provider-390.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: '返回列表', exact: true }).click();
  await expect(page.getByLabel('搜索供应商', { exact: true })).toHaveValue(existingName);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.setViewportSize({ width: 1366, height: 768 });
  await first.click();
  await page.screenshot({
    path: '.runtime/ui-redesign/evidence/ai-provider-1366.png',
    fullPage: true,
  });
});

test('T03/A04: a mobile task configuration link opens the requested module and returns to the same filter', async ({
  page,
}) => {
  await loginRoot(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const returnTo = '/admin/jobs?status=BLOCKED_CONFIG';
  await page.goto(
    '/admin/models?tab=bindings&taskKey=grading.selftest&returnTo=' + encodeURIComponent(returnTo),
  );
  const detail = page.locator('.configuration-detail');
  await expect(detail).toBeVisible();
  await expect(detail).toContainText('grading.selftest');
  await page.getByRole('button', { name: '返回列表', exact: true }).click();
  await expect(page.getByLabel('搜索模块', { exact: true })).toBeVisible();
  await expect(page.locator('[data-record-id="grading.selftest"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('link', { name: '返回任务列表', exact: true }).click();
  await expect(page).toHaveURL(
    (url) => url.pathname === '/admin/jobs' && url.searchParams.get('status') === 'BLOCKED_CONFIG',
  );
  await expect(page.getByRole('combobox', { name: '任务状态', exact: true })).toHaveValue(
    'BLOCKED_CONFIG',
  );
});

test('A06: invocation filters, unknown usage and stable paginated details work on a phone', async ({
  page,
}) => {
  await loginRoot(page);
  const actorId = 'ui-call-' + Date.now();
  await prisma.aIInvocation.createMany({
    data: Array.from({ length: 32 }, () => ({
      actorId,
      resourceId: 'ui-regression',
      taskKey: 'admin.model-test',
      status: 'FAILED',
      errorCode: 'AI_CREDENTIAL_NOT_CONFIGURED',
    })),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin/models');
  await page.getByRole('button', { name: '调用记录', exact: true }).click();
  await page.getByText('时间与精确编号筛选', { exact: true }).click();
  await page.getByLabel('账号 ID', { exact: true }).fill(actorId);
  await expect(page.getByText(/当前筛选共 32 次调用/)).toBeVisible();
  await expect(page.locator('.invocation-row')).toHaveCount(30);
  await page.locator('.invocation-row > summary').first().click();
  await expect(page.locator('.invocation-detail').first()).toContainText('输入 未知 / 输出 未知');
  await page.getByRole('button', { name: '刷新调用记录', exact: true }).click();
  await expect(page.locator('.invocation-row').first()).toHaveAttribute('open', '');
  await page.getByRole('button', { name: '下一页调用', exact: true }).click();
  await expect(page.locator('.invocation-row')).toHaveCount(2);
  await page.getByRole('combobox', { name: '调用状态', exact: true }).selectOption('SUCCEEDED');
  await expect(page.getByText('当前筛选下没有调用记录。', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
});

test('S01: one settings navigation entry, legacy mail route and server permissions', async ({
  page,
}) => {
  await loginRoot(page);
  await page.goto('/admin/mail');
  await expect(page).toHaveURL('/admin/settings/mail');
  const nav = page.getByRole('navigation', { name: '主导航', exact: true });
  await expect(nav.getByRole('link', { name: '系统设置', exact: true })).toHaveCount(1);
  await expect(nav.getByRole('link', { name: '邮件服务', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('navigation', { name: '系统设置分类' }).getByRole('link'),
  ).toHaveCount(1);
  await expect(page.getByRole('heading', { name: '系统设置', exact: true })).toBeVisible();
  await expect(page.locator('input[autocomplete="current-password"]')).toHaveCount(0);
  const student = await page.context().browser()!.newPage();
  try {
    await prepareLogin(student, 'student');
    await student.getByLabel('已绑定邮箱', { exact: true }).fill('student@tuheng.local');
    await student.getByLabel('密码', { exact: true }).fill(process.env.SEED_PASSWORD!);
    await student.getByRole('button', { name: '登录', exact: true }).click();
    await expect(student).toHaveURL('/student/dashboard');
    expect((await student.request.get('/api/settings/mail')).status()).toBe(401);
  } finally {
    await student.close();
  }
});

test('S04: authorization is requested on save; cancellation and server expiry retain the draft without replaying mutations', async ({
  page,
}) => {
  await loginRoot(page);
  await page.goto('/admin/models');
  const name = '[UI测试]再认证-' + Date.now();
  await page.getByRole('button', { name: '新增供应商', exact: true }).click();
  await page.getByLabel('显示名称', { exact: true }).fill(name);
  let posts = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/ai') posts++;
  });
  const save = page.getByRole('button', { name: '保存供应商版本', exact: true });
  const dialog = page.getByRole('dialog', { name: '验证身份', exact: true });
  await save.click();
  await expect(dialog).toBeVisible();
  expect(posts).toBe(0);
  await dialog.getByLabel('当前密码', { exact: true }).fill('a canceled input');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByLabel('显示名称', { exact: true })).toHaveValue(name);
  await save.click();
  await expect(dialog.getByLabel('当前密码', { exact: true })).toHaveValue('');
  await dialog.getByLabel('当前密码', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await dialog.getByRole('button', { name: '验证并继续', exact: true }).click();
  await expect(page.getByText('已保存，新版本立即生效。已有调用保留原快照。')).toBeVisible();
  expect(posts).toBe(1);
  await page.getByLabel('显示名称', { exact: true }).fill(name + '-保留草稿');
  await prisma.reauthentication.updateMany({
    where: { accountId: 'admin' },
    data: { expiresAt: new Date(0) },
  });
  await save.click();
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel('显示名称', { exact: true })).toHaveValue(name + '-保留草稿');
  expect(posts).toBe(2);
  await dialog.getByLabel('当前密码', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await dialog.getByRole('button', { name: '验证并继续', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(posts).toBe(2);
  await save.click();
  await expect(page.getByText('已保存，新版本立即生效。已有调用保留原快照。')).toBeVisible();
  expect(posts).toBe(3);
  const provider = await prisma.aIProvider.findFirstOrThrow({
    where: { name: name + '-保留草稿' },
  });
  expect(provider.currentVersion).toBe(2);
  await page.route('**/api/ai', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'test read interruption' }),
        })
      : route.continue(),
  );
  await page.getByLabel('显示名称', { exact: true }).fill(name + '-读取中断');
  await save.click();
  await expect(
    page.getByText('操作已保存，但读取最新配置失败。请刷新配置后继续，勿重复保存。'),
  ).toBeVisible();
  await expect(save).toHaveCount(0);
  expect(posts).toBe(4);
  await page.unroute('**/api/ai');
  await page.getByRole('button', { name: '刷新配置', exact: true }).click();
  await expect(page.getByLabel('显示名称', { exact: true })).toHaveValue(name + '-读取中断');
  expect(
    (await prisma.aIProvider.findUniqueOrThrow({ where: { id: provider.id } })).currentVersion,
  ).toBe(3);
});
test('G06/G07: scoped personnel details protect unsaved edits and stay usable on a phone', async ({
  page,
}) => {
  await loginRoot(page);
  const name = '[UI测试]人员-' + Date.now();
  const create = await page.request.post('/api/organization/create-teacher', {
    headers: { Origin: 'http://localhost:3000' },
    data: { schoolId: 'school-demo', name },
  });
  expect(create.ok()).toBe(true);
  await page.goto('/admin/users');
  await page.getByLabel('搜索学校', { exact: true }).fill('图衡自动化测试学校');
  await page
    .getByRole('combobox', { name: '当前操作学校', exact: true })
    .selectOption('school-demo');
  await page.getByLabel('搜索姓名 / 登录 ID / 学号', { exact: true }).fill(name);
  const row = page.locator('.organization-row').filter({ hasText: name });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: '查看详情', exact: true }).click();
  const detail = page.getByRole('dialog', { name: '教师详情：' + name, exact: true });
  await detail.getByLabel('姓名', { exact: true }).fill(name + '-未保存');
  await page.keyboard.press('Escape');
  const warning = page.getByRole('dialog', { name: '未保存的修改', exact: true });
  await expect(warning).toBeVisible();
  await warning.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(detail.getByLabel('姓名', { exact: true })).toHaveValue(name + '-未保存');
  await detail.getByRole('button', { name: '关闭对话框', exact: true }).click();
  await warning.getByRole('button', { name: '丢弃修改', exact: true }).click();
  await expect(detail).not.toBeVisible();
  await expect(row).not.toContainText('-未保存');
  await page.setViewportSize({ width: 390, height: 844 });
  await row.getByRole('button', { name: '查看详情', exact: true }).click();
  await expect(detail.getByLabel('姓名', { exact: true })).toHaveValue(name);
  expect(await detail.evaluate((d) => d.scrollWidth <= d.clientWidth + 1)).toBe(true);
  const bounds = await detail.boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(845);
  await page.screenshot({
    path: '.runtime/ui-redesign/evidence/person-detail-390.png',
    fullPage: false,
  });
  await detail.getByLabel('姓名', { exact: true }).fill(name + '-已更新');
  await detail.getByRole('button', { name: '保存资料', exact: true }).click();
  const auth = page.getByRole('dialog', { name: '验证身份', exact: true });
  await auth.getByLabel('当前密码', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await auth.getByRole('button', { name: '验证并继续', exact: true }).click();
  await expect(detail).not.toBeVisible();
  await expect(row).toContainText('-已更新');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
});
test('G06: switching schools clears incompatible filters and ignores the previous request', async ({
  page,
}) => {
  await loginRoot(page);
  const listResponse = await page.request.get('/api/organization/schools?q=图衡自动化测试学校');
  const school = (await listResponse.json()).data.items.find(
    (s: { id: string }) => s.id === 'school-demo',
  );
  expect(typeof school.counts.teachers).toBe('number');
  expect(typeof school.counts.students).toBe('number');
  const { data: proofResult } = await (
    await page.request.post('/api/identity/reauthenticate', {
      headers: { Origin: 'http://localhost:3000' },
      data: { realm: 'STAFF', password: process.env.SEED_PASSWORD },
    })
  ).json();
  const created = await page.request.post('/api/organization/create-school', {
    headers: { Origin: 'http://localhost:3000' },
    data: {
      name: '[UI测试]范围-' + Date.now(),
      administratorName: '范围测试管理员',
      proof: proofResult.proof,
    },
  });
  expect(created.ok()).toBe(true);
  const other = (await created.json()).data.school;
  await page.goto('/admin/users');
  const scope = page.getByRole('combobox', { name: '当前操作学校', exact: true });
  await page.getByLabel('搜索学校', { exact: true }).fill('图衡自动化测试学校');
  await scope.selectOption('school-demo');
  const search = page.getByLabel('搜索姓名 / 登录 ID / 学号', { exact: true });
  await search.fill('不存在的人员');
  await page.getByLabel('搜索学校', { exact: true }).fill(other.name);
  await scope.selectOption(other.id);
  await expect(search).toHaveValue('');
  await expect(page.locator('.management-toolbar')).toContainText(other.name);
  await expect(page.locator('.organization-row')).toHaveCount(0);
  const students = await page.context().browser()!.newPage();
  try {
    const teacherIdentifier = await prepareLogin(students, 'teacher');
    await teacherIdentifier.fill('teacher@tuheng.local');
    await students.getByLabel('密码', { exact: true }).fill(process.env.SEED_PASSWORD!);
    await students.getByRole('button', { name: '登录', exact: true }).click();
    await expect(students).toHaveURL('/teacher/dashboard');
    const forbidden = await students.request.post('/api/organization/create-teacher', {
      headers: { Origin: 'http://localhost:3000' },
      data: { schoolId: other.id, name: 'must-not-create' },
    });
    expect(forbidden.status()).toBe(403);
  } finally {
    await students.close();
  }
});
test('T01/T03: task filters and counts span pages; live details survive status changes and refresh failures on phone', async ({
  page,
}) => {
  await loginRoot(page);
  const question = await prisma.questionVersion.findFirstOrThrow();
  const attempt = await prisma.submissionAttempt.create({
    data: {
      ownerId: 'student',
      questionVersionId: question.id,
      version: 1,
      source: 'ASSIGNMENT',
      idempotencyKey: crypto.randomUUID(),
    },
  });
  const request = requestFixture();
  const runIds: string[] = [];
  for (let i = 0; i < 33; i++) {
    const id = crypto.randomUUID();
    runIds.push(id);
    await prisma.gradingRun.create({
      data: {
        id,
        attemptId: attempt.id,
        status: i === 32 ? 'SUCCEEDED' : 'FAILED',
        promptVersion: request.promptVersion,
        strategyVersion: request.strategyVersion,
        request: { ...request, runId: id },
        job: {
          create: {
            lane: 'formal',
            status: i === 32 ? 'SUCCEEDED' : 'FAILED',
            errorCode: i === 32 ? null : 'AI_SNAPSHOT_REQUIRED',
          },
        },
      },
    });
  }
  await page.goto('/admin/jobs?q=' + attempt.id + '&status=FAILED');
  await expect(page.getByText('当前筛选共 32 个任务', { exact: true })).toBeVisible();
  await expect(page.locator('.job-row')).toHaveCount(30);
  await page.getByRole('button', { name: '下一页任务', exact: true }).click();
  await expect(page.locator('.job-row')).toHaveCount(2);
  await page.getByRole('button', { name: '上一页任务', exact: true }).click();
  await expect(page.locator('.job-row')).toHaveCount(30);
  await page.setViewportSize({ width: 390, height: 844 });
  const row = page.locator('.job-row').first(),
    id = await row.getAttribute('data-run-id');
  await row.locator('.job-select').click();
  const drawer = page.getByRole('dialog', { name: '任务详情', exact: true });
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText('没有可复用的模型快照');
  await prisma.$transaction([
    prisma.gradingRun.update({ where: { id: id! }, data: { status: 'RUNNING' } }),
    prisma.backgroundJob.update({
      where: { runId: id! },
      data: { status: 'RUNNING', errorCode: null },
    }),
  ]);
  await drawer.getByRole('button', { name: '刷新此任务', exact: true }).click();
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText('列表筛选保持不变');
  await expect(drawer.getByText('分析中', { exact: true })).toBeVisible();
  await page.route('**/api/admin/jobs?**', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"error":"TEMPORARILY_UNAVAILABLE"}',
    }),
  );
  await drawer.getByRole('button', { name: '刷新此任务', exact: true }).click();
  await expect(page.getByText(/以下缓存记录可能不是最新/)).toBeVisible();
  await expect(drawer).toContainText(id!);
  await page.screenshot({
    path: '.runtime/ui-redesign/evidence/jobs-detail-390.png',
    fullPage: true,
  });
  await page.unroute('**/api/admin/jobs?**');
  await drawer.getByRole('button', { name: '关闭对话框', exact: true }).click();
  await page.getByRole('button', { name: '刷新任务', exact: true }).click();
  await expect(page.getByText('当前筛选共 31 个任务', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: '任务状态', exact: true })).toHaveValue('FAILED');
  for (const width of [360, 390, 768, 1024, 1366, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
  }
  await page.screenshot({ path: '.runtime/ui-redesign/evidence/jobs-1440.png', fullPage: false });
  const response = await page.request.get('/api/admin/jobs?q=' + attempt.id);
  expect(response.ok()).toBe(true);
  expect(await response.text()).not.toMatch(
    /secretId|ciphertext|geometryAnswer|rawResponse|submissionAssets/,
  );
});
test('T02: mobile confirmation creates one current-config run, requires reauthentication, and preserves the blocked source', async ({
  page,
}) => {
  await loginRoot(page);
  const priorBinding = await prisma.aITaskBindingVersion.findFirst({
    where: { taskKey: 'grading.assignment' },
    orderBy: { version: 'desc' },
  });
  const secret = await prisma.secretRecord.create({
    data: encryptSecret('test-only-no-external-service', 'AI_API_KEY'),
  });
  const provider = await prisma.aIProvider.create({
    data: {
      name: '[TEST] job action fixture',
      brand: 'LOCAL_TEST',
      enabled: true,
      versions: {
        create: {
          version: 1,
          secretId: secret.id,
          config: AIProviderConfig.parse({
            baseUrl: 'http://127.0.0.1:9/v1',
            protocol: 'OPENAI_CHAT_COMPLETIONS',
          }),
        },
      },
    },
  });
  const model = await prisma.aIModel.create({
    data: {
      providerId: provider.id,
      name: '[TEST] job action model',
      enabled: true,
      versions: {
        create: {
          version: 1,
          config: AIModelConfig.parse({
            model: 'job-fixture',
            images: true,
            outputModes: ['prompt_json'],
          }),
          testStatus: {},
        },
      },
    },
  });
  const parameters = AITaskParameters.parse({ outputMode: 'prompt_json' });
  await prisma.aITaskBindingVersion.create({
    data: {
      taskKey: 'grading.assignment',
      version: (priorBinding?.version ?? 0) + 1,
      modelId: model.id,
      parameters,
      enabled: true,
    },
  });
  try {
    const question = await prisma.questionVersion.findFirstOrThrow(),
      request = requestFixture();
    const attempt = await prisma.submissionAttempt.create({
      data: {
        ownerId: 'student',
        questionVersionId: question.id,
        version: 1,
        source: 'ASSIGNMENT',
        idempotencyKey: crypto.randomUUID(),
      },
    });
    const id = crypto.randomUUID();
    await prisma.gradingRun.create({
      data: {
        id,
        attemptId: attempt.id,
        status: 'BLOCKED_CONFIG',
        promptVersion: request.promptVersion,
        strategyVersion: request.strategyVersion,
        request: { ...request, runId: id },
        job: {
          create: { lane: 'formal', status: 'BLOCKED_CONFIG', errorCode: 'AI_SNAPSHOT_REQUIRED' },
        },
      },
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/admin/jobs?q=' + id);
    const row = page.locator('.job-row'),
      action = row.getByRole('button', { name: '使用当前配置新建运行', exact: true });
    await expect(action).toBeVisible();
    const sent: { id: string; requestId: string; proof: string }[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/api/actions/run-current-config'))
        sent.push(r.postDataJSON());
    });
    await action.click();
    const confirm = page.getByRole('dialog', { name: '确认新建运行', exact: true });
    await expect(confirm).toContainText('可能产生新的模型调用费用');
    await confirm.getByRole('button', { name: '取消', exact: true }).click();
    expect(sent).toHaveLength(0);
    await action.click();
    await confirm.getByRole('button', { name: '确认执行', exact: true }).click();
    const auth = page.getByRole('dialog', { name: '验证身份', exact: true });
    await expect(auth).toBeVisible();
    expect(sent).toHaveLength(0);
    await auth.getByLabel('当前密码', { exact: true }).fill(process.env.SEED_PASSWORD!);
    await auth.getByRole('button', { name: '验证并继续', exact: true }).click();
    await expect(page.getByText(/已创建新运行 .*旧运行和正式成绩保持不变/)).toBeVisible();
    expect(sent).toHaveLength(1);
    const repeat = await page.request.post('/api/actions/run-current-config', {
      headers: { Origin: 'http://localhost:3000' },
      data: sent[0],
    });
    expect(repeat.ok()).toBe(true);
    expect(await prisma.gradingRun.count({ where: { id: sent[0].requestId } })).toBe(1);
    expect((await prisma.gradingRun.findUniqueOrThrow({ where: { id } })).status).toBe(
      'BLOCKED_CONFIG',
    );
    expect(
      await prisma.auditLog.count({
        where: { resourceId: sent[0].requestId, action: 'RUN_NEW_CONFIGURATION' },
      }),
    ).toBe(1);
    const rejected = await page.request.post('/api/actions/run-retry', {
      headers: { Origin: 'http://localhost:3000' },
      data: { id, requestId: crypto.randomUUID(), proof: sent[0].proof },
    });
    expect(rejected.status()).toBe(409);
    expect((await rejected.json()).error).toBe('AI_SNAPSHOT_REQUIRED');
    await page.goto('/admin/jobs?q=' + sent[0].requestId);
    await page.locator('.job-select').click();
    await expect(page.getByRole('dialog', { name: '任务详情' })).toContainText(id);
  } finally {
    const latest = await prisma.aITaskBindingVersion.findFirstOrThrow({
      where: { taskKey: 'grading.assignment' },
      orderBy: { version: 'desc' },
    });
    await prisma.aITaskBindingVersion.create({
      data: {
        taskKey: 'grading.assignment',
        version: latest.version + 1,
        modelId: priorBinding?.modelId ?? model.id,
        parameters: priorBinding?.parameters ?? parameters,
        enabled: priorBinding?.enabled ?? false,
      },
    });
    await prisma.aIProvider.update({ where: { id: provider.id }, data: { enabled: false } });
  }
});
