import { expect, type Page } from '@playwright/test';
import { prisma } from '@tuheng/database';
import { GeometryDocument } from '@tuheng/contracts';
import { choose } from './editor-controls';

/** Continue with the actual accounts and downloaded credentials created by the identity flow. */
export async function verifyOnboardedTeaching(teacher: Page, student: Page, studentNumber: string) {
  const title = `[E2E新校全链] ${Date.now()}`;
  await teacher.setViewportSize({ width: 1366, height: 768 });
  await student.setViewportSize({ width: 390, height: 844 });
  await teacher.goto('/teacher/questions/new');
  await teacher.getByLabel('题目名称').fill(title);
  await teacher.getByLabel('题目要求').fill('根据题干投影补充虚线，保留原有蓝色题干。');
  await teacher.getByLabel('点的投影规律', { exact: true }).check();
  await teacher.getByLabel('作答方式').selectOption('VHW_PROJECTION');
  await choose(teacher, '实线');
  await teacher.locator('.geo-active svg').click({ position: { x: 150, y: 130 } });
  await expect(teacher.locator('[data-kind=segment][data-style=PROBLEM_VISIBLE]')).toHaveCount(1);
  await teacher.getByLabel('参考作图与关键步骤').fill('检查对应点的长对正、高平齐和宽相等关系。');
  await teacher.getByLabel('我已检查参考答案与等价正确解法，确认可作为判分依据').check();
  await teacher.getByLabel('我已确认题意、参考答案和评分细则（保存为新版本）').check();
  await teacher.getByRole('button', { name: '保存并确认题目版本' }).click();
  await expect(teacher).toHaveURL('/teacher/questions');
  await teacher.goto('/teacher/assignments/new');
  await teacher.getByLabel('作业标题').fill(title);
  const audience = teacher.locator('.audience-picker');
  await audience.getByRole('button', { name: '清空选择', exact: true }).click();
  await expect(audience.getByText('已选 0 人 · 显式排除 0 人', { exact: true })).toBeVisible();
  const recipient = audience.getByRole('checkbox', { name: new RegExp(studentNumber) });
  await recipient.click();
  await expect(recipient).toBeChecked();
  await expect(audience.getByText('已选 1 人 · 显式排除 0 人', { exact: true })).toBeVisible();
  await teacher.getByLabel('开始时间（当前设备时区）').fill('2026-01-01T08:00');
  await teacher.getByLabel('截止时间（当前设备时区）').fill('2027-12-31T23:59');
  await teacher
    .locator('.question-choice')
    .filter({ hasText: title })
    .getByRole('checkbox')
    .check();
  await teacher.getByRole('button', { name: '保存作业草稿' }).click();
  await expect(teacher).toHaveURL(/\/teacher\/assignments\/[a-f0-9-]{36}$/);
  const assignment = new URL(teacher.url()).pathname.replace('/teacher/', '/student/');
  await teacher.getByRole('button', { name: '确认名单并正式发布' }).click();
  await expect(teacher.getByText('已发布', { exact: true })).toBeVisible();
  await student.goto(assignment);
  await expect(student.locator('.geometry-editor')).toBeVisible();
  await choose(student, '虚线');
  await student.locator('.geo-active svg').click({ position: { x: 100, y: 100 } });
  await expect(student.locator('[data-kind=segment][data-style=ANSWER_HIDDEN]')).toHaveCount(1);
  const saved = student.waitForResponse(
    (r) => r.url().endsWith('/api/actions/draft') && r.request().method() === 'POST',
  );
  await student.getByRole('button', { name: '保存草稿', exact: true }).click();
  const draft = await saved;
  expect(draft.ok()).toBe(true);
  const geometry = GeometryDocument.parse(draft.request().postDataJSON().geometry);
  expect(
    geometry.entities.filter((e) => e.kind === 'segment' && e.lineStyle === 'ANSWER_HIDDEN'),
  ).toHaveLength(1);
  await student.reload();
  await expect(student.locator('[data-kind=segment][data-style=ANSWER_HIDDEN]')).toHaveCount(1);
  student.once('dialog', (dialog) => dialog.accept());
  await student.getByRole('button', { name: '正式提交并排队批改' }).click();
  await expect(student).toHaveURL(/\/student\/results\//);
  const attemptId = student.url().split('/').at(-1)!;
  const run = await prisma.gradingRun.findFirstOrThrow({ where: { attemptId } });
  expect(await prisma.backgroundJob.findUnique({ where: { runId: run.id } })).not.toBeNull();
  await expect(student.getByRole('heading', { name: '教师正式成绩' })).toHaveCount(0);
  await teacher.goto(`/teacher/reviews/${attemptId}`);
  await expect(teacher.locator('.geometry-editor')).toBeVisible();
  await teacher.getByLabel('投影关系与作图正确性得分').fill('7.6');
  await teacher.getByLabel('图线表达与作图规范得分').fill('1.8');
  await teacher
    .getByLabel('判分证据与错误说明')
    .nth(0)
    .fill('新建学校流程测试：教师独立核对投影对应关系。');
  await teacher
    .getByLabel('判分证据与错误说明')
    .nth(1)
    .fill('新建学校流程测试：虚线表达仍可改进。');
  await teacher.getByLabel('给学生的指导').fill('继续检查对应投影并规范图线。');
  await teacher.getByRole('button', { name: '保存教师确认结果' }).click();
  await expect(teacher.getByRole('button', { name: '发布正式成绩' })).toBeVisible();
  teacher.once('dialog', (dialog) => dialog.accept());
  await teacher.getByRole('button', { name: '发布正式成绩' }).click();
  await expect(teacher.getByText('正式成绩已发布', { exact: true })).toBeVisible();
  await student.reload();
  await expect(student.getByRole('heading', { name: '教师正式成绩' })).toBeVisible();
  await expect(student.locator('.result-score')).toContainText('9.4');
  await student.goto('/student/errors');
  await expect(student.getByRole('heading', { name: title })).toBeVisible();
}
