import { prepareLogin } from './identity-login';
import { test, expect, type Page } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { choose, draw, settings, closePanels, properties } from './editor-controls';
import { performanceDocument } from '../geometry-fixtures';
import { loadGeometryDocument } from '@tuheng/geometry-core';
async function login(page: Page, who = 'teacher') {
  const identifier = await prepareLogin(page, who);
  await identifier.fill(`${who}@tuheng.local`);
  await page.getByLabel('密码', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/${who}/dashboard`));
}
async function selectSegment(page: Page, style: string) {
  const shape = page
    .locator(`.geo-active [data-kind=segment][data-style="${style}"] > line`)
    .first();
  const p = await shape.evaluate((el) => {
    const line = el as SVGLineElement;
    const pos = new DOMPoint(
      (line.x1.baseVal.value + line.x2.baseVal.value) / 2,
      (line.y1.baseVal.value + line.y2.baseVal.value) / 2,
    ).matrixTransform(line.getScreenCTM()!);
    return { x: pos.x, y: pos.y };
  });
  await page.mouse.click(p.x, p.y);
}
test('anonymous geometry visits return through login and a lost session returns to login', async ({
  page,
  context,
}) => {
  await page.goto('/geometry');
  await expect(page).toHaveURL('/login?callbackUrl=%2Fgeometry');
  await expect(page.getByText('暂时无法加载')).toHaveCount(0);
  await prepareLogin(page, 'student', '/geometry');
  await expect(page.locator('.geometry-editor')).toHaveCount(0);
  await page.getByLabel('已绑定邮箱', { exact: true }).fill('student@tuheng.local');
  await page.getByLabel('密码', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL('/geometry');
  await expect(page.locator('.geometry-editor')).toBeVisible();
  await expect(page.getByRole('main', { name: '独立几何作图' })).toBeVisible();
  await expect(page.getByRole('contentinfo', { name: '网站信息' })).toHaveCount(0);
  await context.clearCookies();
  await page.reload();
  await expect(page).toHaveURL('/login?callbackUrl=%2Fgeometry');
  await expect(page.locator('.geometry-editor')).toHaveCount(0);
});

test('external login return URLs stay inside the application', async ({ page }) => {
  await prepareLogin(page, 'student', 'https://example.invalid/geometry');
  await page.getByLabel('已绑定邮箱', { exact: true }).fill('student@tuheng.local');
  await page.getByLabel('密码', { exact: true }).fill(process.env.SEED_PASSWORD!);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL('/student/dashboard');
});

test('the file menu downloads the current schema and round-trips an editable JSON example', async ({
  page,
}) => {
  await login(page, 'student');
  await page.goto('/geometry');
  const schemaDownload = page.waitForEvent('download');
  await choose(page, '下载图纸 JSON Schema');
  const schema = await schemaDownload;
  expect(schema.suggestedFilename()).toBe('tuheng.geometry.schema.json');
  expect(JSON.parse(readFileSync(await schema.path(), 'utf8')).properties.schemaVersion.const).toBe(
    'tuheng.geometry/3.0.0',
  );

  const input = page.getByLabel('加载几何 JSON');
  const example = readFileSync('docs/geometry-examples/AI-LINE-V3.json', 'utf8');
  await input.setInputFiles({
    name: 'example.json',
    mimeType: 'application/json',
    buffer: Buffer.from(example),
  });
  const canvas = page.getByLabel('统一展开图绘图区');
  await expect(canvas.locator('[data-kind=segment]')).toHaveCount(1);
  const drawingDownload = page.waitForEvent('download');
  await choose(page, '导出 JSON');
  const drawing = await drawingDownload;
  const text = readFileSync(await drawing.path(), 'utf8');
  expect(text).toContain('"position": { "x": 15, "y": 10 }');
  expect(loadGeometryDocument(text)).toEqual(loadGeometryDocument(example));

  await page.reload();
  await expect(canvas.locator('[data-kind=segment]')).toHaveCount(0);
  await input.setInputFiles(await drawing.path());
  await expect(canvas.locator('[data-kind=segment]')).toHaveCount(1);
});

test('JSON validation, projection links, touch zoom and the multi-object mobile fixture', async ({
  page,
}) => {
  await login(page, 'student');
  await page.goto('/geometry');
  await draw(page, '点', 130, 110);
  await choose(page, '点');
  // Choose H by its actual sheet position; no manual frame selection.
  const h = await page.locator('.geo-active svg').evaluate((el) => {
    const p = new DOMPoint(-30, 20).matrixTransform((el as SVGSVGElement).getScreenCTM()!);
    return { x: p.x, y: p.y };
  });
  await page.mouse.click(h.x, h.y);
  await choose(page, '投影关联');
  await page.locator('[data-kind=point]').nth(0).locator('circle').first().click();
  await page.locator('[data-kind=point]').nth(1).locator('circle').first().click();
  await expect(page.locator('.cad-step-message')).toContainText('投影关联已记录');
  await page.getByLabel('加载几何 JSON').setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"schemaVersion":"invalid"}'),
  });
  await expect(page.locator('.cad-step-message')).toContainText('加载失败');
  await expect(page.locator('[data-kind=point]')).toHaveCount(2);
  const fixture = performanceDocument();
  // Importers may choose stable view IDs and projection conventions independently of the UI.
  for (const view of fixture.views) {
    const original = view.id;
    view.id = `imported-${original}`;
    fixture.entities
      .filter((e) => e.viewId === original)
      .forEach((e) => {
        e.viewId = view.id;
      });
  }
  fixture.projectionConfig.convention = 'THIRD_ANGLE_RIGHT';
  const start = Date.now();
  await page.getByLabel('加载几何 JSON').setInputFiles({
    name: 'performance.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await expect(page.locator('[data-entity-id]')).toHaveCount(fixture.entities.length);
  await page.setViewportSize({ width: 390, height: 844 });
  const canvas = page.locator('.geo-active svg'),
    initial = await canvas.getAttribute('viewBox');
  const box = (await canvas.boundingBox())!;
  await canvas.dispatchEvent('pointerdown', {
    pointerId: 31,
    pointerType: 'touch',
    button: 0,
    clientX: box.x + 90,
    clientY: box.y + 100,
  });
  await canvas.dispatchEvent('pointerdown', {
    pointerId: 32,
    pointerType: 'touch',
    button: 0,
    clientX: box.x + 180,
    clientY: box.y + 100,
  });
  await canvas.dispatchEvent('pointermove', {
    pointerId: 32,
    pointerType: 'touch',
    buttons: 1,
    clientX: box.x + 240,
    clientY: box.y + 110,
  });
  await expect(canvas).not.toHaveAttribute('viewBox', initial!);
  for (const pointerId of [31, 32])
    await canvas.dispatchEvent('pointerup', { pointerId, pointerType: 'touch', button: 0 });
  await expect(page.locator('[data-entity-id]')).toHaveCount(fixture.entities.length);
  await choose(page, '适应画布');
  await closePanels(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/geometry-mobile.png', fullPage: true });
  console.log(`Geometry mobile fixture loaded and interacted in ${Date.now() - start} ms`);
});
test('four editors load, draw, undo, export, and keep mobile views and raw pen strokes usable', async ({
  page,
}) => {
  await login(page, 'student');
  await page.goto('/geometry');
  page.on('dialog', (d) => d.accept());
  for (const type of ['VHW_PROJECTION', 'THREE_VIEW', 'ISOMETRIC', 'OBLIQUE_DIMETRIC']) {
    if (type !== 'VHW_PROJECTION') await page.getByLabel('图纸类型').selectOption(type);
    await draw(page, '点');
    await expect(page.locator('.geo-active [data-kind=point]')).toHaveCount(1);
    if (type === 'THREE_VIEW')
      await expect(page.locator('.geo-active [data-kind=point] text')).toHaveCount(0);
    await draw(page, '实线', 200, 150);
    await expect(page.locator('.geo-active [data-kind=segment]')).toHaveCount(1);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await expect(page.locator('.geo-active [data-kind=segment]')).toHaveCount(0);
    await page.getByRole('button', { name: '恢复', exact: true }).click();
    await expect(page.locator('.geo-active [data-kind=segment]')).toHaveCount(1);
    await selectSegment(page, 'ANSWER_VISIBLE');
    await properties(page);
    const style = page.getByRole('combobox', { name: '线型', exact: true });
    await expect(style.locator('option[value=CONSTRUCTION]')).toHaveCount(0);
    await style.selectOption('ANSWER_HIDDEN');
    await choose(page, '确认属性');
    await expect(
      page.locator('.geo-active [data-kind=segment][data-style=ANSWER_HIDDEN]'),
    ).toHaveCount(1);
    await page.getByRole('combobox', { name: '线型', exact: true }).selectOption('ANSWER_VISIBLE');
    await choose(page, '确认属性');
    await expect(page.locator('.geo-active [data-kind=segment]')).toHaveCount(1);
    await draw(page, '圆', 220, 80);
    await page.locator('.geo-active svg').click({ position: { x: 250, y: 80 } });
    await expect(page.locator('.geo-active [data-kind=circle]')).toHaveCount(1);
    const canvas = page.locator('.geo-active svg');
    const step = page.getByRole('region', { name: 'CAD 命令' });
    await choose(page, '圆弧');
    await expect(step).toContainText('选择圆心');
    // Use raw click coordinates for the arc surrounded by previously drawn outlines.
    await page.keyboard.down('Alt');
    try {
      await canvas.click({ position: { x: 220, y: 220 } });
      await expect(step).toContainText('选择起点');
      await canvas.click({ position: { x: 250, y: 220 } });
      await expect(step).toContainText('选择终点');
      await canvas.click({ position: { x: 220, y: 190 } });
    } finally {
      await page.keyboard.up('Alt');
    }
    await expect(canvas.locator('[data-kind=arc]')).toHaveCount(1);
    const download = page.waitForEvent('download');
    await choose(page, '导出 JSON');
    await closePanels(page);
    expect((await download).suggestedFilename()).toBe('tuheng.json');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await draw(page, '虚线', 100, 100);
  await expect(page.locator('[data-kind=segment][data-style=ANSWER_HIDDEN]')).toHaveCount(1);
  await choose(page, '电子笔');
  await settings(page);
  await page.getByLabel('虚拟直尺', { exact: true }).check();
  await closePanels(page);
  const svg = page.locator('.geo-active svg');
  await svg.scrollIntoViewIfNeeded();
  const rulerPath = await svg.evaluate((el) => {
    const m = (el as SVGSVGElement).getScreenCTM()!;
    return Array.from({ length: 31 }, (_, i) => {
      const p = new DOMPoint(5 + i, -5 - Math.sin(i) * 0.1).matrixTransform(m);
      return { x: p.x, y: p.y };
    });
  });
  await svg.dispatchEvent('pointerdown', {
    pointerId: 19,
    pointerType: 'pen',
    button: 0,
    clientX: rulerPath[0].x,
    clientY: rulerPath[0].y,
    pressure: 0.5,
  });
  for (let i = 0; i < 30; i++)
    await svg.dispatchEvent('pointermove', {
      pointerId: 19,
      pointerType: 'pen',
      buttons: 1,
      clientX: rulerPath[i].x,
      clientY: rulerPath[i].y,
      pressure: 0.5,
    });
  await svg.dispatchEvent('pointerup', {
    pointerId: 19,
    pointerType: 'pen',
    button: 0,
    clientX: rulerPath[30].x,
    clientY: rulerPath[0].y,
    pressure: 0,
  });
  await expect(page.locator('.geo-active [data-kind=segment]')).toHaveCount(3);
  const svgDownload = page.waitForEvent('download');
  await choose(page, '导出展开图 SVG');
  await closePanels(page);
  const exportedSvg = readFileSync((await (await svgDownload).path())!, 'utf8');
  expect(exportedSvg).not.toContain('data-transient');
  expect(exportedSvg).not.toContain('#d97706');
  expect(exportedSvg).toContain('non-scaling-stroke');
});
test('teacher geometry question is versioned and student submits a pure vector snapshot', async ({
  browser,
}) => {
  const teacher = await browser.newPage(),
    student = await browser.newPage();
  const title = `[E2E几何] ${Date.now()}`;
  teacher.on('dialog', (d) => d.accept());
  student.on('dialog', (d) => d.accept());
  await login(teacher);
  await teacher.goto('/teacher/questions/new');
  await teacher.getByLabel('题目名称').fill(title);
  await teacher.getByLabel('题目要求').fill('补全对应投影，保留辅助线。');
  await teacher.getByLabel('点的投影规律', { exact: true }).check();
  await teacher.getByLabel('作答方式').selectOption('VHW_PROJECTION');
  await teacher
    .locator('.geometry-editor')
    .getByRole('button', { name: '展开编辑', exact: true })
    .click();
  await expect(teacher.locator('.geometry-editor.geo-expanded')).toBeVisible();
  await draw(teacher, '实线');
  await expect(teacher.locator('[data-style=PROBLEM_VISIBLE][data-kind=segment]')).toHaveCount(1);
  await teacher
    .locator('.geometry-editor')
    .getByRole('button', { name: '退出展开', exact: true })
    .click();
  await expect(teacher).toHaveURL('/teacher/questions/new');
  await teacher.getByLabel('参考作图与关键步骤').fill('对应投影的横坐标一致。');
  await teacher.getByLabel('我已检查参考答案与等价正确解法，确认可作为判分依据').check();
  await teacher.getByLabel('我已确认题意、参考答案和评分细则（保存为新版本）').check();
  await teacher.getByRole('button', { name: '保存并确认题目版本' }).click();
  await expect(teacher).toHaveURL('/teacher/questions');
  await teacher.goto('/teacher/assignments/new');
  await teacher.getByLabel('作业标题').fill(title);
  await expect(teacher.getByText('已选 2 人', { exact: false })).toBeVisible();
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
  await login(student, 'student');
  await student.setViewportSize({ width: 1440, height: 900 });
  await student.goto(assignment);
  const task = student.getByRole('complementary', { name: '本题作答' });
  await expect(task.getByRole('heading', { name: title })).toBeVisible();
  await expect(task).toContainText('第 1 / 1 题');
  await expect(task).toContainText('补全对应投影，保留辅助线。');
  await expect(task.getByText('未保存', { exact: true })).toBeVisible();
  await draw(student, '虚线', 180, 140);
  await expect(student.locator('[data-kind=segment][data-style=ANSWER_HIDDEN]')).toHaveCount(1);
  await draw(student, '辅助线', 120, 100);
  await choose(student, '新增投影轴');
  await student.getByRole('button', { name: '开始定位新轴', exact: true }).click();
  const sheet = student.locator('.geo-active svg');
  const axisCanvas = (await sheet.boundingBox())!;
  const axisPoint = (x: number, y: number) =>
    sheet.click({ position: { x: axisCanvas.width * x, y: axisCanvas.height * y } });
  await axisPoint(0.3, 0.46);
  await axisPoint(0.3, 0.7);
  await axisPoint(0.22, 0.57);
  await student.getByRole('button', { name: '确认新轴', exact: true }).click();
  await expect(student.locator('[data-axis-id]')).toHaveCount(1);
  await selectSegment(student, 'PROBLEM_VISIBLE');
  await choose(student, '平行线');
  await sheet.click({ position: { x: 300, y: 180 } });
  await choose(student, '确认创建');
  await expect(task.getByText('有未保存修改', { exact: true })).toBeVisible();
  await student.getByRole('button', { name: '展开编辑', exact: true }).click();
  const taskBox = (await task.boundingBox())!;
  const canvasBox = (await sheet.boundingBox())!;
  expect(taskBox.x).toBeGreaterThanOrEqual(canvasBox.x + canvasBox.width - 1);
  mkdirSync('docs/evidence/cad-workspace', { recursive: true });
  await student.screenshot({ path: 'docs/evidence/cad-workspace/assignment-desktop.png' });
  await student.setViewportSize({ width: 390, height: 844 });
  const toggle = student.getByRole('button', { name: '查看题目与提交' });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(task).toBeVisible();
  const rubric = task.getByText('查看评分细则', { exact: true });
  await rubric.click();
  await expect(rubric.locator('..')).toHaveAttribute('open', '');
  await rubric.click();
  await student.screenshot({ path: 'docs/evidence/cad-workspace/assignment-phone.png' });
  const draftResponse = student.waitForResponse(
    (response) =>
      response.url().endsWith('/api/actions/draft') && response.request().method() === 'POST',
  );
  await student.getByRole('button', { name: '保存草稿', exact: true }).click();
  const draftRequest = (await draftResponse).request().postDataJSON();
  expect(draftRequest.geometry.auxiliarySystems).toHaveLength(1);
  expect(draftRequest.geometry.schemaVersion).toBe('tuheng.geometry/3.0.0');
  expect(draftRequest.geometry.referenceRelations.length).toBeGreaterThan(0);
  const missingReference = structuredClone(draftRequest);
  missingReference.geometry.referenceRelations[0].reference = {
    kind: 'projectionAxis',
    systemId: 'missing',
  };
  const badReference = await student.request.post('/api/actions/draft', {
    headers: { Origin: new URL(student.url()).origin },
    data: missingReference,
  });
  expect(badReference.status()).toBe(400);
  const forged = structuredClone(draftRequest);
  const stemPoint = forged.geometry.entities.find(
    (e: { kind: string; lineStyle: string }) =>
      e.kind === 'point' && e.lineStyle === 'PROBLEM_VISIBLE',
  );
  stemPoint.position.x += 5;
  const denied = await student.request.post('/api/actions/draft', {
    headers: { Origin: new URL(student.url()).origin },
    data: forged,
  });
  expect(denied.status()).toBe(403);
  expect((await denied.json()).error).toBe('GEOMETRY_STEM_CHANGED');
  const axisForgery = structuredClone(draftRequest);
  axisForgery.geometry.views[0].transform.origin.x += 2;
  const deniedAxis = await student.request.post('/api/actions/draft', {
    headers: { Origin: new URL(student.url()).origin },
    data: axisForgery,
  });
  expect(deniedAxis.status()).toBe(403);
  await expect(student.getByText('草稿已保存，可稍后继续。')).toBeVisible();
  await expect(task.getByText('已保存', { exact: true })).toBeVisible();
  await student.reload();
  await expect(student.locator('[data-axis-id]')).toHaveCount(1);
  await expect(student.locator('[data-kind=segment][data-style=ANSWER_HIDDEN]')).toHaveCount(1);
  await student.getByRole('button', { name: '正式提交并排队批改' }).click();
  await expect(student).toHaveURL(/\/student\/results\//);
  await expect(student.locator('[data-kind=segment][data-style=ANSWER_HIDDEN]')).toHaveCount(1);
  const id = student.url().split('/').at(-1);
  await teacher.goto(`/teacher/reviews/${id}`);
  await expect(teacher.locator('.geometry-editor')).toBeVisible();
  await expect(teacher.locator('[data-kind=segment][data-style=ANSWER_HIDDEN]')).toHaveCount(1);
  await expect(
    teacher.locator('.geometry-editor').getByRole('button', { name: '撤销', exact: true }),
  ).toBeDisabled();
  await teacher.close();
  await student.close();
});
