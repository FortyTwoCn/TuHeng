import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { prisma } from '@tuheng/database';
import { prepareLogin } from './identity-login';
test('school catalog, teacher class deep link, school question versions and reviewer publication', async ({
  browser,
}) => {
  test.setTimeout(150000);
  const tag = randomUUID().slice(0, 8);
  const schoolPage = await browser.newPage({ viewport: { width: 1366, height: 768 } }),
    teacherPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const evidence = 'test-results/teaching-organization';
  mkdirSync(evidence, { recursive: true });
  try {
    const seed = await prisma.user.findUniqueOrThrow({ where: { id: 'teacher' } }),
      school = await prisma.school.create({
        data: { name: '图衡教学验证学校', code: 'UX-' + tag },
      });
    const login = async (page: Page, kind: 'SCHOOL_ADMIN' | 'TEACHER', name: string) => {
      const loginId = (kind === 'TEACHER' ? 'T' : 'S') + tag,
        email = loginId.toLowerCase() + '@test.invalid';
      const account = await prisma.user.create({
        data: {
          loginId,
          name,
          kind,
          roles: [kind],
          realm: 'STAFF',
          email,
          emailNormalized: email,
          emailVerifiedAt: new Date(),
          passwordHash: seed.passwordHash,
          schoolId: school.id,
          mustChangePassword: false,
        },
      });
      const id = await prepareLogin(page, 'teacher');
      await id.fill(loginId);
      await page.getByLabel('密码', { exact: true }).fill(process.env.SEED_PASSWORD!);
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await expect(page).toHaveURL(kind === 'TEACHER' ? '/teacher/dashboard' : '/school/dashboard');
      return account;
    };
    const admin = await login(schoolPage, 'SCHOOL_ADMIN', '学校管理员'),
      teacher = await login(teacherPage, 'TEACHER', '陈老师');
    await expect(schoolPage.getByRole('heading', { name: '学校概览', exact: true })).toBeVisible();
    await schoolPage.getByRole('link', { name: '课程与开课学期', exact: true }).first().click();
    await schoolPage.getByRole('button', { name: '新增课程', exact: true }).click();
    const drawer = schoolPage.getByRole('dialog');
    await drawer.getByLabel('课程名称').fill('工程制图');
    await drawer.getByLabel('本校课程编号').fill('EG01');
    await drawer.getByRole('button', { name: '保存', exact: true }).click();
    await schoolPage.getByRole('link', { name: /工程制图.*EG01/ }).click();
    for (const term of ['2026秋', '2027春']) {
      await schoolPage.getByRole('button', { name: '新增开课学期' }).click();
      await drawer.getByLabel('学期', { exact: true }).fill(term);
      await drawer.getByRole('button', { name: '保存', exact: true }).click();
      await expect(schoolPage.getByRole('link', { name: term, exact: true })).toBeVisible();
    }
    await schoolPage.screenshot({ path: evidence + '/school-catalog.png' });
    await schoolPage.getByRole('link', { name: '2026秋', exact: true }).click();
    await expect(schoolPage).toHaveURL((url) => /\/offerings\/[\w-]+$/.test(url.pathname));
    const offeringId = new URL(schoolPage.url()).pathname.split('/').at(-1)!;
    await teacherPage.goto('/teacher/classes');
    await teacherPage.getByRole('button', { name: '新增教学班' }).click();
    const td = teacherPage.getByRole('dialog');
    await td.getByLabel('班级名称').fill('制图一班');
    await td.getByRole('combobox', { name: '课程 / 学期', exact: true }).selectOption(offeringId);
    await td.getByRole('button', { name: '保存', exact: true }).click();
    await teacherPage.getByRole('link', { name: /制图一班/ }).click();
    await expect(teacherPage).toHaveURL((url) => /\/teacher\/classes\/[\w-]+$/.test(url.pathname));
    const classPath = new URL(teacherPage.url()).pathname;
    await teacherPage.reload();
    await expect(teacherPage.getByRole('heading', { name: '制图一班', exact: true })).toBeVisible();
    await teacherPage.getByRole('button', { name: '加入学生' }).click();
    await td.getByLabel('学号', { exact: true }).fill('000715');
    await td.getByLabel('学生姓名').fill('李同学');
    await td.getByRole('button', { name: '保存', exact: true }).click();
    await expect(teacherPage.getByText('李同学', { exact: true })).toBeVisible();
    for (const [width, height] of [
      [360, 800],
      [390, 844],
      [768, 1024],
      [1024, 768],
      [1366, 768],
      [1440, 900],
    ]) {
      await teacherPage.setViewportSize({ width, height });
      expect(
        await teacherPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      await expect(teacherPage.getByRole('button', { name: '调整授课教师' })).toHaveCount(0);
      if (width === 390 || width === 1366)
        await teacherPage.screenshot({ path: evidence + '/teacher-class-' + width + '.png' });
    }
    await schoolPage.goto(classPath.replace('/teacher/', '/school/'));
    await expect(schoolPage.getByRole('button', { name: '调整授课教师' })).toBeVisible();
    await schoolPage.goto('/school/dashboard');
    await schoolPage.screenshot({ path: evidence + '/school-overview.png' });
    await schoolPage.goto('/school/questions/new');
    const title = '画出点的投影 ' + tag;
    await schoolPage.getByLabel('题目名称').fill(title);
    await schoolPage.getByLabel('题目要求').fill('请补充点的水平投影并说明作图步骤。');
    await schoolPage.getByLabel('点的投影规律', { exact: true }).check();
    await schoolPage.getByLabel('参考作图与关键步骤').fill('检查对应点的长对正和宽相等。');
    await schoolPage.getByLabel('我已检查参考答案与等价正确解法，确认可作为判分依据').check();
    await schoolPage.getByLabel('我已确认题意、参考答案和评分细则（保存为新版本）').check();
    await schoolPage.getByRole('button', { name: '保存并确认题目版本' }).click();
    await expect(schoolPage).toHaveURL('/school/questions');
    await schoolPage.getByRole('link', { name: '编辑新版本' }).click();
    await schoolPage.getByLabel('题目名称').fill(title + ' 第二版');
    await schoolPage.getByRole('button', { name: '保存并确认题目版本' }).click();
    await expect(schoolPage).toHaveURL('/school/questions');
    await schoolPage.goto('/school/assignments');
    await schoolPage.getByRole('link', { name: /布置作业/ }).click();
    await expect(schoolPage).toHaveURL('/school/assignments/new');
    await schoolPage.getByLabel('作业标题').fill(title);
    await schoolPage.getByLabel('开始时间（当前设备时区）').fill('2026-01-01T08:00');
    await schoolPage.getByLabel('截止时间（当前设备时区）').fill('2027-12-31T23:59');
    const picker = schoolPage.locator('.audience-picker');
    await picker.getByRole('button', { name: '清空选择', exact: true }).click();
    await expect(picker.getByText(/已选 0 人/).first()).toBeVisible();
    const recipient = picker.getByRole('checkbox', { name: /000715/ });
    await recipient.click();
    await expect(recipient).toBeChecked();
    await expect(picker.getByText(/已选 1 人/).first()).toBeVisible();
    await schoolPage
      .getByRole('group', { name: '默认复核教师' })
      .getByRole('checkbox', { name: /陈老师/ })
      .first()
      .check();
    await schoolPage
      .locator('.question-choice')
      .filter({ hasText: title + ' 第二版' })
      .getByRole('checkbox')
      .check();
    await schoolPage.getByRole('button', { name: '保存作业草稿' }).click();
    await expect(schoolPage).toHaveURL((url) =>
      /\/school\/assignments\/[\w-]+$/.test(url.pathname),
    );
    await schoolPage.getByRole('button', { name: '确认名单并正式发布' }).click();
    await expect(schoolPage.getByText('已发布', { exact: true })).toBeVisible();
    const published = await prisma.assignment.findFirstOrThrow({
      where: { creatorId: admin.id, title, status: 'PUBLISHED' },
    });
    expect(
      (await prisma.assignmentRecipient.findFirstOrThrow({ where: { assignmentId: published.id } }))
        .reviewerIds,
    ).toEqual([teacher.id]);
    await expect(schoolPage.getByRole('heading', { name: '学生提交', exact: true })).toHaveCount(0);
    expect((await schoolPage.request.get('/school/unknown-management-page')).status()).toBe(404);
  } finally {
    await Promise.all([schoolPage.close(), teacherPage.close()]);
  }
});
