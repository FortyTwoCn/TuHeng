import { test, expect, type Page } from '@playwright/test';
import { prisma } from '@tuheng/database';
import { hash } from 'bcryptjs';
import sharp from 'sharp';
import { prepareLogin } from './identity-login';

const output = '.runtime/profile-round/evidence';
const origin = process.env.TEST_APP_ORIGIN ?? 'http://localhost:3000';
async function login(page: Page, user: 'student' | 'teacher' | 'admin') {
  const input = await prepareLogin(page, user);
  await input.fill(user === 'admin' ? 'admin' : user + '@tuheng.local');
  await page.getByLabel('密码', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL('/' + user + '/dashboard');
}
const profile = (page: Page) =>
  page.getByRole('banner').getByRole('link', { name: '用户中心', exact: true });
const bell = (page: Page) => page.getByRole('button', { name: /^通知(?:，|$)/ });

test.use({ hasTouch: true });
test('two authentication realms keep private avatars, profile settings and mobile navigation independent', async ({
  page,
  context,
}) => {
  const teacher = await context.newPage();
  await login(page, 'student');
  await login(teacher, 'teacher');
  await page.setViewportSize({ width: 390, height: 844 });
  await profile(page).tap();
  await expect(page).toHaveURL('/student/profile');
  await expect(page.getByRole('heading', { name: '用户中心' })).toBeVisible();
  const avatar = await sharp({
    create: { width: 320, height: 240, channels: 3, background: '#128884' },
  })
    .composite([
      {
        input: await sharp({
          create: { width: 120, height: 240, channels: 3, background: '#2473a8' },
        })
          .png()
          .toBuffer(),
        left: 0,
        top: 0,
      },
    ])
    .png()
    .toBuffer();
  await page
    .getByLabel('选择头像图片', { exact: true })
    .setInputFiles({ name: 'avatar-test.png', mimeType: 'image/png', buffer: avatar });
  const dialog = page.getByRole('dialog', { name: '调整头像' });
  await expect(dialog.getByAltText('裁切预览')).toBeVisible();
  await dialog.getByRole('slider', { name: '缩放' }).fill('1.5');
  await page.screenshot({ path: output + '/avatar-crop-mobile.png' });
  await dialog.getByRole('button', { name: '保存头像', exact: true }).tap();
  await expect(page.getByText('头像已更新。')).toBeVisible();
  const studentImage = profile(page).locator('img');
  await expect(studentImage).toBeVisible();
  await expect
    .poll(() => studentImage.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBe(128);
  const url = (await studentImage.getAttribute('src'))!;
  expect((await teacher.request.get(url.replace('realm=STUDENT', 'realm=STAFF'))).status()).toBe(
    404,
  );
  const studentInfo = await page.request.get('/api/profile', {
    headers: { 'x-tuheng-realm': 'STUDENT' },
  });
  const staffInfo = await page.request.get('/api/profile', {
    headers: { 'x-tuheng-realm': 'STAFF' },
  });
  expect((await studentInfo.json()).data).toMatchObject({ kind: 'STUDENT' });
  expect((await staffInfo.json()).data).toMatchObject({ kind: 'TEACHER' });
  await page.getByRole('switch', { name: '接收教学邮件' }).check();
  await page.getByRole('button', { name: '保存通知设置' }).tap();
  await expect(page.getByText('通知设置已保存。')).toBeVisible();
  expect(
    (
      await (
        await teacher.request.get('/api/profile', { headers: { 'x-tuheng-realm': 'STAFF' } })
      ).json()
    ).data.preferences.emailEnabled,
  ).toBe(false);
  await profile(teacher).click();
  await expect(teacher).toHaveURL('/teacher/profile');
  const widths = [360, 390, 768, 1024, 1366, 1440];
  for (const width of widths) {
    await page.setViewportSize({ width, height: width === 768 ? 1024 : 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    for (const control of [profile(page), bell(page)]) {
      const size = (await control.boundingBox())!;
      expect(size.width).toBeGreaterThanOrEqual(44);
      expect(size.height).toBeGreaterThanOrEqual(44);
    }
    if (width === 390 || width === 768 || width === 1440) {
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: output + `/profile-${width}.png`, fullPage: true });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '更多导航' }).tap();
  await expect(
    page.getByRole('dialog', { name: '更多工作空间导航' }).getByRole('link', { name: '用户中心' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  page.once('dialog', (event) => event.accept());
  await page.getByRole('button', { name: '移除头像', exact: true }).tap();
  await expect(page.getByText('已恢复默认头像。')).toBeVisible();
  await expect(profile(page).locator('img')).toHaveCount(0);
  expect((await page.request.get(url)).status()).toBe(404);
  await page.getByRole('switch', { name: '接收教学邮件' }).uncheck();
  await page.getByRole('button', { name: '保存通知设置' }).tap();
  await expect(page.getByText('通知设置已保存。')).toBeVisible();
});

test('announcement draft, precise recipients, publishing, phone notification and authorized deep link', async ({
  page,
  context,
  browser,
}) => {
  const student = await context.newPage();
  await login(page, 'teacher');
  await login(student, 'student');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('link', { name: '公告管理', exact: true }).click();
  await page.getByRole('link', { name: '新建公告' }).click();
  const title = '图纸讲评安排';
  const editor = page.getByRole('region', { name: '公告内容' });
  await editor.getByLabel('标题', { exact: true }).fill(title);
  await editor
    .getByLabel('正文', { exact: true })
    .fill('周五带上本周的投影图纸。\n课堂先交流作图步骤，再核对三面投影。');
  await page
    .getByRole('combobox', { name: '王老师的接收设置', exact: true })
    .selectOption('include');
  await page
    .getByRole('combobox', { name: '林同学的接收设置', exact: true })
    .selectOption('include');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByRole('heading', { name: '编辑公告草稿' })).toBeVisible();
  await expect(editor.getByLabel('标题', { exact: true })).toHaveValue(title);
  await page.screenshot({ path: output + '/announcement-editor-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({ path: output + '/announcement-editor-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '预览接收人' }).click();
  const confirmation = page.getByRole('dialog', { name: '确认发布公告' });
  await expect(confirmation).toContainText('共 2 位接收人，其中教师 1 位，学生 1 位');
  await confirmation.getByRole('button', { name: '确认发布', exact: true }).click();
  await expect(confirmation).not.toBeVisible();
  await expect(page.getByRole('heading', { name: title, exact: true, level: 1 })).toBeVisible();
  const id = new URL(page.url()).pathname.split('/').at(-1)!;
  const target = '/student/announcements/' + id;
  expect(
    (await prisma.announcementRecipient.findMany({ where: { announcementId: id } }))
      .map((p) => p.userId)
      .sort(),
  ).toEqual(['student', 'teacher']);
  await student.setViewportSize({ width: 390, height: 844 });
  await student.goto('/student/dashboard');
  await expect(bell(student)).toHaveAccessibleName(/条未读/);
  await student.screenshot({ path: output + '/mobile-header.png' });
  await bell(student).tap();
  const recent = student.getByRole('dialog', { name: '最近通知' });
  const link = student.locator(`a[href="${target}"]`);
  await expect(recent.locator('.notification-list li').filter({ has: link })).toContainText(title);
  const viewAll = recent.getByRole('link', { name: '查看全部通知' });
  await expect(viewAll).toBeInViewport({ ratio: 1 });
  await student.screenshot({ path: output + '/notifications-mobile.png' });
  await viewAll.tap();
  await expect(student).toHaveURL('/student/notifications');
  await student.getByLabel('通知分类', { exact: true }).selectOption('ANNOUNCEMENT');
  const row = student.locator('.notification-list li').filter({ has: link });
  await expect(row).toContainText('未读');
  await row.getByRole('checkbox').check();
  await student.getByRole('button', { name: /所选标为已读/ }).tap();
  await expect(row.getByRole('button', { name: '标记已读' })).toHaveCount(0);
  await student.evaluate(() => scrollTo(0, 0));
  await student.screenshot({ path: output + '/notification-center-mobile.png', fullPage: true });
  await row.getByRole('link', { name: '查看详情' }).tap();
  await expect(student).toHaveURL(target);
  await expect(student.getByText('周五带上本周的投影图纸。', { exact: false })).toBeVisible();
  const guest = await browser.newPage();
  try {
    await guest.goto(target);
    const requested = new URL(guest.url());
    expect(requested.pathname).toBe('/login');
    expect(requested.searchParams.get('realm')).toBe('student');
    expect(requested.searchParams.get('callbackUrl')).toBe(target);
  } finally {
    await guest.close();
  }
});

test('site and school administrators reach their own profiles and setup remains mandatory', async ({
  page,
}) => {
  await login(page, 'admin');
  await profile(page).click();
  await expect(page).toHaveURL('/admin/profile');
  await expect(page.getByText('平台账号', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '用户中心' })).toBeVisible();
  const loginId = 'S-PROFILE-' + crypto.randomUUID().slice(0, 12);
  await prisma.user.create({
    data: {
      name: '学校管理测试',
      email: '',
      emailNormalized: loginId.toLowerCase() + '@tuheng.invalid',
      emailVerifiedAt: new Date(),
      passwordHash: await hash(process.env.SEED_PASSWORD!, 4),
      kind: 'SCHOOL_ADMIN',
      realm: 'STAFF',
      roles: ['SCHOOL_ADMIN'],
      schoolId: 'school-demo',
      loginId,
      mustChangePassword: true,
    },
  });
  await page.goto('/login?realm=staff&callbackUrl=' + encodeURIComponent('/school/profile'));
  await page.getByLabel('登录 ID / 已绑定邮箱', { exact: true }).fill(loginId);
  await page.getByLabel('密码', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '首次账号设置' })).toBeVisible();
  expect(
    (await page.request.get('/api/profile', { headers: { 'x-tuheng-realm': 'STAFF' } })).status(),
  ).toBe(403);
  await page.getByLabel('当前密码', { exact: true }).fill(process.env.SEED_PASSWORD!);
  const next = 'Profile-Test-Password-2026!';
  await page.getByLabel('新密码', { exact: true }).fill(next);
  await page.getByLabel('确认新密码', { exact: true }).fill(next);
  await page.getByRole('button', { name: '确认修改', exact: true }).click();
  await page.getByRole('link', { name: '进入工作空间' }).click();
  await expect(page).toHaveURL('/school/profile');
  await expect(page.getByText(loginId, { exact: true })).toBeVisible();
  expect(
    (
      await page.request.post('/api/announcements', {
        headers: { Origin: origin, 'x-tuheng-realm': 'STAFF' },
        data: {
          operation: 'preview',
          input: {
            title: '范围限制',
            body: '报给全平台',
            audience: {
              scope: { kind: 'PLATFORM' },
              allStudents: true,
              allTeachers: false,
              studentClassIds: [],
              teacherClassIds: [],
              personIds: [],
              excludeIds: [],
            },
          },
        },
      })
    ).status(),
  ).toBe(403);
});
