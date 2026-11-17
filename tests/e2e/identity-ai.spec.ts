import { test, expect, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { hash } from 'bcryptjs';
import { SMTPServer } from 'smtp-server';
import { prisma } from '@tuheng/database';
import { prepareLogin } from './identity-login';

const origin = 'http://localhost:3000';
const password = 'Browser-Identity-2026!new';
const mail: string[] = [];
let smtp: SMTPServer;
test.beforeAll(async () => {
  smtp = new SMTPServer({
    disabledCommands: ['AUTH', 'STARTTLS'],
    onData(stream, _session, done) {
      let body = '';
      stream.on('data', (c) => (body += c.toString()));
      stream.on('end', () => {
        mail.push(body);
        done();
      });
    },
  });
  await new Promise<void>((resolve) => smtp.listen(1026, '127.0.0.1', resolve));
});
test.afterAll(async () => {
  await new Promise<void>((resolve) => smtp.close(resolve));
  await prisma.$disconnect();
});
async function api(page: Page, path: string, data: object, realm = 'STAFF') {
  const response = await page.request.post(path, {
    headers: { Origin: origin, 'x-tuheng-realm': realm },
    data,
  });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).data;
}
async function rootLogin(page: Page) {
  await prepareLogin(page, 'admin');
  await page.getByLabel('已绑定邮箱', { exact: true }).fill('admin@tuheng.local');
  await page.getByLabel('密码', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL('/admin/dashboard');
}
async function loginId(
  page: Page,
  id: string,
  temporary: string,
  realm = 'STAFF',
  school?: { id: string; name: string },
) {
  await page.goto('/login/' + realm.toLowerCase());
  if (school) {
    await page.getByLabel('搜索学校').fill(school.name);
    await expect(page.getByRole('combobox', { name: '学校', exact: true })).toContainText(
      school.name,
    );
    await page.getByRole('combobox', { name: '学校', exact: true }).selectOption(school.id);
  }
  await page
    .getByLabel(realm === 'STAFF' ? '登录 ID / 已绑定邮箱' : '学号', { exact: true })
    .fill(id);
  await page.getByLabel('密码', { exact: true }).fill(temporary);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL('/onboarding/' + realm.toLowerCase());
}
function lastCode() {
  const message = mail.at(-1)!;
  const part = message.match(
    /Content-Type: text\/html[\s\S]*?Content-Transfer-Encoding: (\S+)\r\n\r\n([\s\S]*?)(?=\r\n--)/i,
  )!;
  const body =
    part[1].toLowerCase() === 'base64'
      ? Buffer.from(part[2], 'base64').toString('utf8')
      : part[2]
          .replace(/=\r?\n/g, '')
          .replace(/=([A-F0-9]{2})/gi, (_m, h) => String.fromCharCode(parseInt(h, 16)));
  return body.match(/<strong>(\d{6})<\/strong>/)![1];
}
async function credentials(page: Page, batchId: string, kind: string, proof: string) {
  const { token } = await api(page, '/api/credentials', {
    operation: 'prepare',
    batchId,
    kind,
    proof,
  });
  const r = await page.request.post('/api/credentials', {
    headers: { Origin: origin },
    data: { token },
  });
  expect(r.status()).toBe(200);
  expect(r.headers()['cache-control']).toContain('no-store');
  const book = new ExcelJS.Workbook();
  await book.xlsx.load((await r.body()) as unknown as ExcelJS.Buffer);
  const row = book.worksheets[0].getRow(3);
  // Consumed download tickets cannot be replayed.
  expect(
    (
      await page.request.post('/api/credentials', { headers: { Origin: origin }, data: { token } })
    ).status(),
  ).toBe(410);
  return {
    id: String(row.getCell(kind === 'STUDENT' ? 4 : 3).value),
    password: String(row.getCell(kind === 'STUDENT' ? 6 : 4).value),
  };
}
async function changePassword(page: Page, temporary: string) {
  await page.getByLabel('当前密码', { exact: true }).fill(temporary);
  await page.getByLabel('新密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '确认修改', exact: true }).click();
  await expect(page.getByText('✓ 密码已更新', { exact: true })).toBeVisible();
}
async function bind(page: Page, email: string) {
  const before = mail.length;
  await page.getByLabel('邮箱', { exact: true }).fill(email);
  await page.getByRole('button', { name: '发送验证码', exact: true }).click();
  await expect.poll(() => mail.length).toBeGreaterThan(before);
  await page.getByLabel('六位验证码', { exact: true }).fill(lastCode());
  await page.getByRole('button', { name: '验证并绑定', exact: true }).click();
  await expect(page.getByText('✓ 邮箱已验证', { exact: true })).toBeVisible();
}
test('identity: real SMTP setup, school and teacher onboarding, one-use delivery, dual sessions and student ID', async ({
  browser,
}) => {
  test.setTimeout(150000);
  const root = await browser.newPage(),
    staff = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await rootLogin(root);
  await root.goto('/admin/mail');
  await root.getByLabel('验证当前密码（敏感操作授权 10 分钟）').fill(process.env.SEED_PASSWORD!);
  await root.getByRole('button', { name: '验证身份', exact: true }).click();
  await expect(root.getByText('已验证', { exact: true })).toBeVisible();
  await root.getByLabel('配置名称').fill('Browser local SMTP ' + Date.now());
  await root.getByLabel('SMTP 主机').fill('127.0.0.1');
  await root.getByLabel('端口', { exact: true }).fill('1026');
  await root.getByLabel('传输安全').selectOption('LOCAL_TEST');
  await root.getByLabel('发件邮箱').fill('browser@tuheng.invalid');
  await root.getByRole('button', { name: '保存为新版本', exact: true }).click();
  const v = root.locator('.identity-list article').first();
  await expect(v).toContainText('Browser local SMTP');
  await v.getByRole('button', { name: '测试连接', exact: true }).click();
  await expect(root.getByText('连接与认证通过，尚未证明邮件已送达。')).toBeVisible();
  await v.getByRole('button', { name: '启用', exact: true }).click();
  await expect(v.getByRole('button', { name: '停用', exact: true })).toBeVisible();
  const { proof } = await api(root, '/api/identity/reauthenticate', {
    realm: 'STAFF',
    password: process.env.SEED_PASSWORD,
  });
  const tag = Date.now();
  const school = await api(root, '/api/organization/create-school', {
    name: 'Browser学校' + tag,
    administratorName: '学校管理员',
    proof,
  });
  const initial = await credentials(root, school.credentialBatchId, 'SCHOOL_ADMIN', proof);
  await root.goto('/admin/users?schoolId=' + school.school.id);
  await root.getByLabel('搜索学校', { exact: true }).fill(school.school.name);
  await root
    .getByRole('combobox', { name: '当前操作学校', exact: true })
    .selectOption(school.school.id);
  await root.getByRole('button', { name: '凭据交付', exact: true }).click();
  const delivery = root
    .locator('section')
    .filter({ has: root.getByRole('heading', { name: '初始凭据交付', exact: true }) })
    .first();
  await delivery
    .getByLabel('验证当前密码（敏感操作授权 10 分钟）')
    .fill(process.env.SEED_PASSWORD!);
  await delivery.getByRole('button', { name: '验证身份', exact: true }).click();
  await root.getByRole('button', { name: '学校管理账号交付', exact: true }).first().click();
  const card = root.getByRole('region', { name: '学校管理账号一次性交付卡' });
  await expect(card.getByLabel('登录 ID', { exact: true })).toHaveValue(initial.id);
  // Compare without recording a cleartext credential in screenshots or assertions.
  expect(
    (await card.getByLabel('临时密码', { exact: true }).inputValue()) === initial.password,
  ).toBe(true);
  await card.getByRole('button', { name: '关闭并清除卡片' }).click();
  await expect(card).toHaveCount(0);
  await loginId(staff, initial.id, initial.password);
  expect((await staff.request.get('/api/organization/accounts')).status()).toBe(403);
  expect((await staff.request.get('/api/ai')).status()).toBe(403);
  await changePassword(staff, initial.password);
  expect((await staff.request.get('/api/organization/accounts')).status()).toBe(403);
  await bind(staff, 'school' + tag + '@browser.invalid');
  await staff.getByRole('link', { name: '进入工作空间', exact: true }).click();
  await expect(staff).toHaveURL('/school/dashboard');
  expect((await staff.request.get('/api/ai')).status()).toBe(403);
  const teacher = await api(staff, '/api/organization/create-teacher', {
    schoolId: school.school.id,
    name: 'Browser教师',
  });
  const schoolProof = (
    await api(staff, '/api/identity/reauthenticate', { realm: 'STAFF', password })
  ).proof;
  const teacherInitial = await credentials(
    staff,
    teacher.credentialBatchId,
    'TEACHER',
    schoolProof,
  );
  const dualContext = await browser.newContext();
  const teacherPage = await dualContext.newPage();
  await loginId(teacherPage, teacherInitial.id, teacherInitial.password);
  await changePassword(teacherPage, teacherInitial.password);
  await bind(teacherPage, 'teacher' + tag + '@browser.invalid');
  await teacherPage.getByRole('link', { name: '进入工作空间', exact: true }).click();
  await expect(teacherPage).toHaveURL('/teacher/dashboard');
  const offering = await api(teacherPage, '/api/organization/create-course', {
    schoolId: school.school.id,
    title: '测试课程',
    code: 'browser',
    term: '2026',
  });
  const cls = await api(teacherPage, '/api/organization/create-class', {
    schoolId: school.school.id,
    offeringId: offering.id,
    name: 'Browser班级',
    teacherId: teacher.id,
  });
  const student = await api(teacherPage, '/api/organization/upsert-student', {
    schoolId: school.school.id,
    name: 'Browser学生',
    studentNumber: '0000123',
    classIds: [cls.id],
  });
  const teacherProof = (
    await api(teacherPage, '/api/identity/reauthenticate', { realm: 'STAFF', password })
  ).proof;
  const studentInitial = await credentials(
    teacherPage,
    student.credentialBatchId,
    'STUDENT',
    teacherProof,
  );
  expect(studentInitial.id).toBe('0000123');
  // Same context now carries two isolated authenticated identities.
  const studentPage = await teacherPage.context().newPage();
  await loginId(studentPage, studentInitial.id, studentInitial.password, 'STUDENT', school.school);
  expect((await studentPage.request.get('/api/notifications')).status()).toBe(401);
  expect(
    (
      await studentPage.request.get('/api/notifications', {
        headers: { 'x-tuheng-realm': 'STUDENT' },
      })
    ).status(),
  ).toBe(403);
  await changePassword(studentPage, studentInitial.password);
  await studentPage.getByRole('link', { name: '暂不绑定邮箱，进入学习空间', exact: true }).click();
  await expect(studentPage).toHaveURL('/student/dashboard');
  const cookies = await studentPage.context().cookies();
  for (const realm of ['student', 'staff'])
    expect(cookies.find((c) => c.name === 'tuheng.' + realm + '.session-token')?.httpOnly).toBe(
      true,
    );
  expect((await studentPage.request.get('/api/identity/status?realm=STAFF')).status()).toBe(200);
  expect((await studentPage.request.get('/api/identity/status?realm=STUDENT')).status()).toBe(200);
  await studentPage.goto('/geometry?realm=STUDENT');
  await studentPage.reload();
  await expect(studentPage.getByRole('heading', { name: '几何作图', exact: true })).toBeVisible();
  await studentPage.goto('/student/dashboard');
  await studentPage.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(studentPage).toHaveURL('/login');
  expect((await studentPage.request.get('/api/identity/status?realm=STUDENT')).status()).toBe(401);
  expect((await studentPage.request.get('/api/identity/status?realm=STAFF')).status()).toBe(200);
  const response = await teacherPage.request.get('/api/organization/accounts?schoolId=school-demo');
  expect(response.status()).toBe(200); // Server ignores supplied school and fixes the teacher scope.
  expect(
    (await response.json()).data.items.every(
      (u: { schoolId: string }) => u.schoolId === school.school.id,
    ),
  ).toBe(true);

  for (const [manager, kind] of [
    [teacherPage, 'TEACHER'],
    [staff, 'SCHOOL'],
  ] as const) {
    await manager.goto(kind === 'TEACHER' ? '/teacher/classes' : '/school/users');
    await manager.getByRole('button', { name: 'Excel 导入', exact: true }).click();
    await manager
      .getByRole('combobox', { name: '课程 / 学期', exact: true })
      .selectOption(offering.id);
    const workbook = new ExcelJS.Workbook(),
      sheet = workbook.addWorksheet('名单');
    sheet.addRow(
      kind === 'TEACHER' ? ['班级', '学号', '学生姓名'] : ['教师名', '班级', '学号', '学生姓名'],
    );
    sheet.addRow(
      kind === 'TEACHER'
        ? ['导入班级', '000078', '导入学生']
        : ['四列导入教师', '四列班级', '000079', '四列学生'],
    );
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
    await manager.getByLabel('上传 XLSX（最多 5 MB、5000 行）', { exact: true }).setInputFiles({
      name: 'browser-' + kind + '.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: bytes,
    });
    await expect(manager.getByText('预计新增教师', { exact: false })).toBeVisible();
    if (kind === 'SCHOOL') {
      await manager.getByLabel('确认该组对应同一位教师').check();
      await manager.getByRole('button', { name: '保存映射并重新预检', exact: true }).click();
    }
    await manager.getByRole('button', { name: '确认执行导入', exact: true }).click();
    await expect(manager.getByText('状态：SUCCEEDED', { exact: false })).toBeVisible({
      timeout: 45000,
    });
    const delivery = manager
      .locator('section')
      .filter({ has: manager.getByRole('heading', { name: '初始凭据交付', exact: true }) })
      .last();
    await delivery.getByLabel('验证当前密码（敏感操作授权 10 分钟）').fill(password);
    await delivery.getByRole('button', { name: '验证身份', exact: true }).click();
    await expect(delivery.getByText('已验证', { exact: true })).toBeVisible();
    for (const label of kind === 'SCHOOL'
      ? ['下载教师初始凭据', '下载学生初始凭据']
      : ['下载学生初始凭据']) {
      const download = manager.waitForEvent('download');
      await delivery.getByRole('button', { name: label, exact: true }).first().click();
      const file = await download;
      expect(file.suggestedFilename()).toContain(label.includes('教师') ? '教师' : '学生');
      expect(await file.failure()).toBeNull();
    }
    await manager.setViewportSize({ width: 390, height: 844 });
    expect(
      await manager.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    ).toBe(true);
    await manager.screenshot({
      path: '.runtime/identity-evidence/import-' + kind + '.png',
      fullPage: true,
    });
  }
  await root.close();
  await staff.close();
  await teacherPage.close();
  await studentPage.close();
  await dualContext.close();
});

test('AI: browser provider versions mask keys, model and module forms; responsive management', async ({
  page,
}) => {
  await rootLogin(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '更多导航', exact: true }).click();
  await page
    .getByRole('navigation', { name: '移动端更多导航' })
    .getByRole('link', { name: 'AI 模型配置', exact: true })
    .click();
  await expect(page).toHaveURL('/admin/models');
  await expect(page.getByRole('dialog', { name: '更多工作空间导航' })).not.toBeVisible();
  await page.getByLabel('验证当前密码（敏感操作授权 10 分钟）').fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: '验证身份', exact: true }).click();
  await expect(page.getByText('已验证', { exact: true })).toBeVisible();
  const name = 'Browser provider ' + Date.now();
  await page.getByLabel('显示名称', { exact: true }).fill(name);
  await page
    .getByLabel('API Key（留空保持原值）', { exact: true })
    .fill('test-protocol-placeholder-no-network-secret');
  await page.getByRole('button', { name: '保存供应商版本', exact: true }).click();
  await expect(page.getByText('已保存，新版本立即生效。已有调用保留原快照。')).toBeVisible();
  await expect(page.getByLabel('API Key（留空保持原值）')).toHaveValue('');
  const r = await page.request.get('/api/ai');
  const json = await r.text();
  expect(json).not.toContain('test-protocol-placeholder-no-network-secret');
  expect(json).not.toContain('ciphertext');
  await page.getByRole('button', { name: '模型目录', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存模型版本', exact: true })).toBeVisible();

  await page.getByRole('combobox', { name: '供应商', exact: true }).selectOption({ label: name });
  await page.getByLabel('模型显示名', { exact: true }).fill(name + ' model');
  await page.getByLabel('供应商实际 model ID', { exact: true }).fill('browser-test-model');
  await page.getByRole('button', { name: '保存模型版本', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '编辑模型', exact: true })).toHaveValue(/.+/);
  await page.getByRole('button', { name: '模块规则', exact: true }).click();
  await expect(page.getByText('grading.assignment', { exact: false }).first()).toBeVisible();
  const rule = page.locator('form').filter({ hasText: 'grading.assignment' });
  await rule
    .getByRole('combobox', { name: '调用模型', exact: true })
    .selectOption({ label: name + ' model（不可用）' });
  await rule.getByLabel('启用此规则', { exact: true }).uncheck();
  await rule.getByRole('combobox', { name: '输出模式', exact: true }).selectOption('prompt_json');
  await rule.getByLabel('temperature（空白不发送）', { exact: true }).fill('');
  await rule.getByRole('button', { name: '保存模块规则', exact: true }).click();
  await expect
    .poll(async () => {
      const data = await (await page.request.get('/api/ai')).json();
      const model = data.models.find((m: { name: string }) => m.name === name + ' model');
      return data.bindings.some(
        (b: { taskKey: string; modelId: string; enabled: boolean }) =>
          b.taskKey === 'grading.assignment' && b.modelId === model?.id && !b.enabled,
      );
    })
    .toBe(true);
  await page.reload();
  await page.getByRole('button', { name: '模块规则', exact: true }).click();
  await expect(rule.getByRole('combobox', { name: '调用模型', exact: true })).toHaveValue(/.+/);
  for (const [width, height] of [
    [360, 800],
    [390, 844],
    [768, 1024],
    [1024, 768],
    [1440, 900],
  ]) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({
      path: '.runtime/identity-evidence/ai-' + width + '.png',
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '更多导航', exact: true }).click();
  await page
    .getByRole('navigation', { name: '移动端更多导航' })
    .getByRole('link', { name: '邮件服务', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: '邮件服务', exact: true })).toBeVisible();
  await page.goto('/admin/users');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({
    path: '.runtime/identity-evidence/organization-mobile.png',
    fullPage: true,
  });
});

test('first admin: password change opens the dashboard without SMTP or email binding; backend mail remains available', async ({
  page,
}) => {
  expect(process.env.SEED_TEST_ACCOUNTS).toBe('1');
  expect(new URL(process.env.DATABASE_URL!).pathname).toBe('/tuheng_test');
  const before = await prisma.user.findUniqueOrThrow({ where: { id: 'admin' } });
  const enabledMail = await prisma.sMTPConfigurationVersion.findMany({
    where: { enabled: true },
    select: { id: true },
  });
  try {
    await prisma.sMTPConfigurationVersion.updateMany({
      where: { enabled: true },
      data: { enabled: false },
    });
    await prisma.user.update({
      where: { id: before.id },
      data: {
        mustChangePassword: true,
        installationComplete: false,
        email: '',
        emailNormalized: null,
        emailVerifiedAt: null,
        passwordExpiresAt: new Date(Date.now() + 86400000),
        tokenVersion: { increment: 1 },
      },
    });
    await prepareLogin(page, 'admin');
    await page.getByLabel('已绑定邮箱', { exact: true }).fill('admin@tuheng.local');
    // An unverified email cannot authenticate; root's fixed ID remains available.
    await page.getByRole('button', { name: '登录 ID', exact: true }).click();
    await page.getByLabel('登录 ID / 已绑定邮箱').fill('admin');
    await page.getByLabel('密码', { exact: true }).fill(process.env.SEED_PASSWORD!);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL('/onboarding/staff');
    expect((await page.request.get('/api/ai')).status()).toBe(403);
    await expect(page.getByRole('heading', { name: '邮件服务', exact: true })).toHaveCount(0);
    await expect(page.getByText('验证绑定邮箱', { exact: false })).toHaveCount(0);
    expect(
      (
        await page.request.post('/api/organization/create-school', {
          headers: { Origin: origin },
          data: { name: 'must-not-create', administratorName: 'forbidden', proof: '' },
        })
      ).status(),
    ).toBe(403);
    const mailBefore = mail.length;
    await page.getByLabel('当前密码', { exact: true }).fill(process.env.SEED_PASSWORD!);
    await page.getByLabel('新密码', { exact: true }).fill(password);
    await page.getByRole('button', { name: '确认修改', exact: true }).click();
    await expect(page).toHaveURL('/admin/dashboard');
    expect((await page.request.get('/api/ai')).status()).toBe(200);
    expect(
      (await (await page.request.get('/api/identity/status?realm=STAFF')).json()).data,
    ).toMatchObject({
      kind: 'SITE_ADMIN',
      emailVerified: false,
      emailBindingRequired: false,
      onboarding: false,
      installationComplete: true,
      smtpConfigured: false,
    });
    expect(mail).toHaveLength(mailBefore);
    // Old bookmarks must not bring an initialized root back into the removed email setup.
    await page.goto('/onboarding/staff');
    await expect(page).toHaveURL('/admin/dashboard');
    await page.goto('/admin/mail');
    const mailPanel = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: '邮件服务', exact: true }) })
      .first();
    await mailPanel.getByLabel('验证当前密码（敏感操作授权 10 分钟）').fill(password);
    await mailPanel.getByRole('button', { name: '验证身份', exact: true }).click();
    await mailPanel.getByLabel('配置名称').fill('Optional backend SMTP');
    await mailPanel.getByLabel('SMTP 主机').fill('127.0.0.1');
    await mailPanel.getByLabel('端口', { exact: true }).fill('1026');
    await mailPanel.getByLabel('传输安全').selectOption('LOCAL_TEST');
    await mailPanel.getByLabel('发件邮箱').fill('install@tuheng.invalid');
    await mailPanel.getByRole('button', { name: '保存为新版本', exact: true }).click();
    const newest = mailPanel.locator('.identity-list article').first();
    await expect(newest).toContainText('Optional backend SMTP');
    await newest.getByRole('button', { name: '启用', exact: true }).click();
    await expect(newest.getByRole('button', { name: '停用', exact: true })).toBeVisible();
    await page.goto('/admin/security');
    await expect(page.getByText('邮箱绑定为可选项，可用于邮箱登录和找回密码。')).toBeVisible();
    await page.getByRole('button', { name: '退出当前身份', exact: true }).click();
    await prepareLogin(page, 'admin');
    await page.getByRole('button', { name: '登录 ID', exact: true }).click();
    await page.getByLabel('登录 ID / 已绑定邮箱').fill('admin');
    await page.getByLabel('密码', { exact: true }).fill(password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL('/admin/dashboard');
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: 'admin' } })).installationComplete,
    ).toBe(true);
  } finally {
    await prisma.$transaction([
      prisma.sMTPConfigurationVersion.updateMany({ data: { enabled: false } }),
      prisma.sMTPConfigurationVersion.updateMany({
        where: { id: { in: enabledMail.map((config) => config.id) } },
        data: { enabled: true },
      }),
    ]);
    await prisma.user.update({
      where: { id: 'admin' },
      data: {
        passwordHash: before.passwordHash,
        mustChangePassword: before.mustChangePassword,
        installationComplete: before.installationComplete,
        email: before.email,
        emailNormalized: before.emailNormalized,
        emailVerifiedAt: before.emailVerifiedAt,
        passwordExpiresAt: before.passwordExpiresAt,
        tokenVersion: { increment: 1 },
      },
    });
  }
});

test('email methods: same verified address stays isolated across domains, codes and recovery work on phone', async ({
  browser,
}) => {
  test.setTimeout(90000);
  const root = await browser.newPage();
  await rootLogin(root);
  const proof = (
    await api(root, '/api/identity/reauthenticate', {
      realm: 'STAFF',
      password: process.env.SEED_PASSWORD,
    })
  ).proof;
  const smtpConfig = await api(root, '/api/settings/mail', {
    action: 'SAVE',
    proof,
    password: '',
    config: {
      name: 'Email methods local SMTP',
      host: '127.0.0.1',
      port: 1026,
      tls: 'LOCAL_TEST',
      username: '',
      fromName: '测试',
      fromEmail: 'email-methods@test.invalid',
    },
  });
  await api(root, '/api/settings/mail', { action: 'ENABLE', id: smtpConfig.id, proof });
  const tag = Date.now(),
    email = 'shared-' + tag + '@browser.invalid';
  const school = await prisma.school.create({
    data: { code: 'METHODS-' + tag, name: '邮箱方法测试学校' },
  });
  const studentPassword = 'Student-Method-2026!',
    staffPassword = 'Staff-Method-2026!';
  const student = await prisma.user.create({
    data: {
      schoolId: school.id,
      name: '邮箱学生',
      email,
      emailNormalized: email,
      emailVerifiedAt: new Date(),
      passwordHash: await hash(studentPassword, 4),
      roles: ['STUDENT'],
      kind: 'STUDENT',
      realm: 'STUDENT',
      studentNumber: '00001',
      mustChangePassword: false,
    },
  });
  const teacher = await prisma.user.create({
    data: {
      schoolId: school.id,
      name: '邮箱教师',
      email,
      emailNormalized: email,
      emailVerifiedAt: new Date(),
      passwordHash: await hash(staffPassword, 4),
      roles: ['TEACHER'],
      kind: 'TEACHER',
      realm: 'STAFF',
      loginId: 'T-METHODS-' + tag,
      mustChangePassword: false,
    },
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  const page = await context.newPage();
  const logout = async () => {
    await page.getByRole('link', { name: '账号安全', exact: true }).tap();
    await page.getByRole('button', { name: '退出当前身份', exact: true }).tap();
    await expect(page).toHaveURL('/login');
  };
  for (const realm of ['STUDENT', 'STAFF'] as const) {
    await page.goto('/login/' + realm.toLowerCase());
    await page.getByRole('button', { name: '邮箱密码', exact: true }).tap();
    await page.getByLabel('已绑定邮箱', { exact: true }).fill(email);
    // The password of the other identity cannot log in even when the address is identical.
    await page
      .getByLabel('密码', { exact: true })
      .fill(realm === 'STUDENT' ? staffPassword : studentPassword);
    await page.getByRole('button', { name: '登录', exact: true }).tap();
    await expect(page.getByRole('alert').filter({ hasText: '账号或凭据不正确' })).toBeVisible();
    await page
      .getByLabel('密码', { exact: true })
      .fill(realm === 'STUDENT' ? studentPassword : staffPassword);
    await page.getByRole('button', { name: '登录', exact: true }).tap();
    await expect(page).toHaveURL(realm === 'STUDENT' ? '/student/dashboard' : '/teacher/dashboard');
    let identity = (await (await page.request.get('/api/identity/status?realm=' + realm)).json())
      .data;
    expect(identity.id).toBe(realm === 'STUDENT' ? student.id : teacher.id);
    await logout();
    await page.goto('/login/' + realm.toLowerCase());
    await page.getByRole('button', { name: '邮箱验证码', exact: true }).tap();
    await page.getByLabel('已绑定邮箱', { exact: true }).fill(email);
    const count = mail.length;
    await page.getByRole('button', { name: '获取验证码', exact: true }).tap();
    await expect.poll(() => mail.length).toBeGreaterThan(count);
    await page.getByLabel('六位验证码').fill(lastCode());
    await page.getByRole('button', { name: '登录', exact: true }).tap();
    await expect(page).toHaveURL(realm === 'STUDENT' ? '/student/dashboard' : '/teacher/dashboard');
    identity = (await (await page.request.get('/api/identity/status?realm=' + realm)).json()).data;
    expect(identity.id).toBe(realm === 'STUDENT' ? student.id : teacher.id);
    await page.screenshot({
      path: '.runtime/identity-evidence/mail-login-' + realm + '.png',
      fullPage: true,
    });
    await logout();
  }
  await page.goto('/login/staff');
  await page.getByRole('button', { name: '忘记密码', exact: true }).tap();
  await page.getByLabel('已绑定邮箱', { exact: true }).fill(email);
  const count = mail.length;
  await page.getByRole('button', { name: '获取验证码', exact: true }).tap();
  await expect.poll(() => mail.length).toBeGreaterThan(count);
  await page.getByLabel('六位验证码').fill(lastCode());
  await page.getByLabel('新密码（至少 12 字符，最多 72 UTF-8 字节）').fill('Recovered-Staff-2026!');
  await page.getByRole('button', { name: '更新密码', exact: true }).tap();
  await expect(page.getByText('密码已更新，请重新登录；首次设置仍需完成。')).toBeVisible();
  await page.getByLabel('已绑定邮箱', { exact: true }).fill(email);
  await page.getByLabel('密码', { exact: true }).fill('Recovered-Staff-2026!');
  await page.getByRole('button', { name: '登录', exact: true }).tap();
  await expect(page).toHaveURL('/teacher/dashboard');
  const studentCookie = (await context.cookies()).find(
    (c) => c.name === 'tuheng.student.session-token',
  );
  expect(studentCookie).toBeUndefined();
  await context.close();
  await root.close();
});
