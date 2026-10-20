import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
const sample = path.resolve('tests/samples/projection.png');
async function login(page: Page, who: string) {
  await page.goto('/login');
  await page.getByLabel('账号邮箱').fill(`${who}@tuheng.local`);
  await page.getByLabel('密码', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: '进入图衡' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/${who.startsWith('student') ? 'student' : who}/dashboard`),
  );
}
test('A/B/D: teacher publishes, student uploads, teacher reviews, student views official grade', async ({
  browser,
}) => {
  const teacher = await browser.newPage(),
    student = await browser.newPage(),
    other = await browser.newPage();
  const title = `[E2E流程测试] 点的投影 ${Date.now()}`;
  await login(teacher, 'teacher');
  await teacher.goto('/teacher/questions/new');
  await teacher.getByLabel('题目名称').fill(title);
  await teacher
    .getByLabel('题目要求')
    .fill('已知点 A 的正面与水平投影，作出第三投影。满足长对正、高平齐、宽相等。');
  await teacher.getByLabel('点的投影规律', { exact: true }).check();
  await teacher.getByLabel('上传题干图或 PDF 资料', { exact: true }).setInputFiles(sample);
  await expect(teacher.locator('.uploaded')).toHaveCount(1);
  await teacher
    .getByLabel('参考作图与关键步骤')
    .fill('通过45度辅助线转移宽度，第三投影与正面投影高平齐。允许圆弧辅助作法。');
  await teacher.getByLabel('上传参考答案', { exact: true }).setInputFiles(sample);
  await expect(teacher.locator('.uploaded')).toHaveCount(2);
  await teacher.getByLabel('我已检查参考答案与等价正确解法，确认可作为判分依据').check();
  await teacher.getByLabel('我已确认题意、参考答案和评分细则（保存为新版本）').check();
  await teacher.getByRole('button', { name: '保存并确认题目版本' }).click();
  await expect(teacher).toHaveURL('/teacher/questions');
  await teacher.goto('/teacher/assignments/new');
  await teacher.getByLabel('作业标题').fill(title);
  await teacher.getByLabel('教学班', { exact: true }).selectOption('class-demo');
  await teacher.getByLabel('开始时间（当前设备时区）').fill('2026-01-01T08:00');
  await teacher.getByLabel('截止时间（当前设备时区）').fill('2027-12-31T23:59');
  await teacher
    .locator('.question-choice')
    .filter({ hasText: title })
    .getByRole('checkbox')
    .check();
  await teacher.getByRole('button', { name: '保存作业草稿' }).click();
  await expect(teacher).toHaveURL(/\/teacher\/assignments\/[a-f0-9-]{36}$/);
  const assignmentPath = new URL(teacher.url()).pathname.replace('/teacher/', '/student/');
  teacher.once('dialog', (d) => d.accept());
  await teacher.getByRole('button', { name: '正式发布作业' }).click();
  await expect(teacher.getByText('已发布', { exact: true })).toBeVisible();
  await login(student, 'student');
  await student.goto(assignmentPath);
  await student.getByLabel('上传作答图纸', { exact: true }).setInputFiles(sample);
  await expect(student.locator('.uploaded')).toHaveCount(1);
  await student.getByRole('button', { name: '保存草稿' }).click();
  await expect(student.getByText('草稿已保存，可稍后继续。')).toBeVisible();
  student.once('dialog', (d) => d.accept());
  await student.getByRole('button', { name: '正式提交并排队批改' }).click();
  await expect(student).toHaveURL(/\/student\/results\/.+/);
  const attemptId = new URL(student.url()).pathname.split('/').pop()!;
  await expect(student.getByText('作答图纸', { exact: true })).toBeVisible();
  await login(other, 'student2');
  await other.goto(`/student/results/${attemptId}`);
  await expect(other.getByText('你没有此资源的操作权限。')).toBeVisible();
  const assetSrc = await student.locator('.drawing-surface img').getAttribute('src');
  expect((await other.request.get(assetSrc!)).status()).toBe(403);
  await teacher.goto(`/teacher/reviews/${attemptId}`);
  await teacher.getByLabel('投影关系与作图正确性得分').fill('7.6');
  await teacher.getByLabel('图线表达与作图规范得分').fill('1.8');
  await teacher
    .getByLabel('判分证据与错误说明')
    .nth(0)
    .fill('流程测试：教师根据投影对应关系确认宽度转移有局部偏差。');
  await teacher.getByLabel('判分证据与错误说明').nth(1).fill('流程测试：辅助线线型需进一步规范。');
  await teacher.getByLabel('给学生的指导').fill('请核对第三投影的宽度转移，保留清晰细辅助线。');
  await teacher.getByRole('button', { name: '保存教师确认结果' }).click();
  await expect(teacher.getByRole('button', { name: '发布正式成绩' })).toBeVisible();
  teacher.once('dialog', (d) => d.accept());
  await teacher.getByRole('button', { name: '发布正式成绩' }).click();
  await expect(teacher.getByText('正式成绩已发布', { exact: true })).toBeVisible();
  await student.reload();
  await expect(student.getByRole('heading', { name: '教师正式成绩' })).toBeVisible();
  await expect(student.locator('.result-score')).toContainText('9.4');
  await student.goto('/student/errors');
  await expect(student.getByRole('heading', { name: title })).toBeVisible();
  await teacher.close();
  await student.close();
  await other.close();
});
test('F: admin creates, searches and disables a real user', async ({ page }) => {
  await login(page, 'admin');
  await page.goto('/admin/users');
  const email = `e2e-${Date.now()}@test.invalid`;
  await page.getByLabel('姓名', { exact: true }).fill('[E2E测试]测试用户');
  await page.getByLabel('邮箱', { exact: true }).fill(email);
  await page.getByLabel('初始密码', { exact: true }).fill('E2E-User-Only-2026!');
  await page.getByRole('button', { name: '创建账号' }).click();
  await expect(page.getByText('用户已创建', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '搜索用户' }).fill(email);
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  const row = page.locator('.list-item').filter({ hasText: email });
  await expect(row).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await row.getByRole('button', { name: '停用', exact: true }).click();
  await expect(row.getByText('已停用', { exact: true })).toBeVisible();
});
test('E: private selftest folder and set are saved, practice has history and no fabricated AI grade', async ({
  page,
}) => {
  await login(page, 'student');
  const title = `[E2E自测] ${Date.now()}`;
  await page.goto('/student/selftests/new');
  await page.getByLabel('题目名称').fill(title);
  await page.getByLabel('题目要求').fill('验证点 A 三面投影的长对正、高平齐、宽相等关系。');
  await page.getByLabel('参考作图与关键步骤').fill('参考关系尚未经教师验证，所有建议需自行核对。');
  await page.getByRole('button', { name: '保存私人题集' }).click();
  await expect(page).toHaveURL('/student/selftests');
  await page.getByText(title, { exact: true }).click();
  await expect(page.getByText('参考答案未经教师验证', { exact: true })).toBeVisible();
  await page.getByLabel('上传作答图纸', { exact: true }).setInputFiles(sample);
  await expect(page.locator('.uploaded')).toHaveCount(1);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '正式提交并排队批改' }).click();
  await expect(page).toHaveURL(/\/student\/results\/.+/);
  await expect(page.getByText('教师正式成绩', { exact: true })).toHaveCount(0);
});
test('security and mobile: unauthenticated and wrong-origin mutations are refused, layout remains usable', async ({
  browser,
}) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  expect(
    (
      await page.request.post('/api/actions/folder', {
        data: { title: 'unauthorized' },
        headers: { Origin: 'http://localhost:3000' },
      })
    ).status(),
  ).toBe(401);
  await login(page, 'student');
  await expect(page.locator('.mobile-nav')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(
    (
      await page.request.post('/api/actions/folder', {
        data: { title: 'wrong-origin' },
        headers: { Origin: 'https://attacker.invalid' },
      })
    ).status(),
  ).toBe(403);
  await page.screenshot({ path: 'test-results/student-mobile.png', fullPage: true });
  await page.close();
});
