import { resetIdentityFixtureThrottle } from '../identity-fixture';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { prisma } from '@tuheng/database';
import { securityDigest } from '../../packages/infrastructure/src/security-throttle';
import type { Actor } from '@tuheng/domain';
import { loadIdentity, changeOwnPassword } from '../../packages/infrastructure/src/identity-auth';
import { reauthenticate } from '../../packages/infrastructure/src/identity-security';
import {
  createSchoolWithAdmin,
  createCourseOffering,
  createTeacher,
  createClass,
  resetAccountPassword,
} from '../../packages/infrastructure/src/organization';
import { parseRosterXlsx, rosterTemplate } from '../../packages/infrastructure/src/roster-xlsx';
import {
  previewRosterImport,
  mapRosterImport,
  commitRosterImport,
  executeRosterImport,
  rosterImportStatus,
} from '../../packages/infrastructure/src/roster-import';
import {
  prepareCredentialDownload,
  downloadCredentials,
  listCredentialDeliveries,
} from '../../packages/infrastructure/src/credential-delivery';
const tag = randomUUID();
let root: Actor,
  proof: string,
  schoolId: string,
  offeringId: string,
  batchId: string,
  credentialBatchId: string;
beforeAll(async () => {
  await resetIdentityFixtureThrottle();
  process.env.TUHENG_SECRET_KEYS = JSON.stringify({ test: randomBytes(32).toString('base64') });
  process.env.TUHENG_SECRET_ACTIVE_KEY = 'test';
  process.env.QUEUE_NAMESPACE = 'identity-roster-test';
  const user = await prisma.user.findUniqueOrThrow({ where: { id: 'admin' } });
  root = await loadIdentity(user.id, 'STAFF', user.tokenVersion, false);
  proof = (await reauthenticate(root, process.env.SEED_PASSWORD!)).proof;
  schoolId = (
    await createSchoolWithAdmin(
      root,
      { name: '导入测试-' + tag, administratorName: '管理测试' },
      proof,
    )
  ).school.id;
  offeringId = (
    await createCourseOffering(root, { schoolId, title: '几何', code: tag, term: '2026 秋季' })
  ).id;
});
afterAll(async () => {
  await prisma.$disconnect();
});
describe.sequential('real XLSX, import and credential delivery', () => {
  it('IM01/04: genuine templates preserve zeros; numeric identifiers and formulas rejected', async () => {
    const bytes = await rosterTemplate('SCHOOL');
    const parsed = await parseRosterXlsx(bytes, 'students.xlsx', 'SCHOOL');
    expect(parsed.rows[0].studentNumber).toBe('00123456');
    expect(parsed.errors).toEqual([]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as unknown as ExcelJS.Buffer);
    wb.worksheets[0].getCell('C2').value = 123456;
    wb.worksheets[0].getCell('D2').value = {
      formula: 'HYPERLINK("https://example.test","x")',
      result: 'x',
    };
    const invalid = await parseRosterXlsx(
      Buffer.from(await wb.xlsx.writeBuffer()),
      'students.xlsx',
      'SCHOOL',
    );
    expect(invalid.errors.map((e) => e.column)).toEqual(['学号', '学生姓名']);
    await expect(parseRosterXlsx(bytes, 'students.xlsm', 'SCHOOL')).rejects.toThrow(
      'XLSX_REQUIRED',
    );
  });
  it('IM08: explicit column mapping retains text identifiers and rejects duplicate mappings', async () => {
    const wb = new ExcelJS.Workbook(),
      sheet = wb.addWorksheet('名单');
    sheet.addRow(['姓名', '学籍', '班级名称']);
    sheet.addRow(['测试学生', '000019', '一班']);
    const bytes = Buffer.from(await wb.xlsx.writeBuffer());
    const parsed = await parseRosterXlsx(bytes, 'mapped.xlsx', 'TEACHER', {
      班级: 3,
      学号: 2,
      学生姓名: 1,
    });
    expect(parsed.rows[0]).toMatchObject({
      studentNumber: '000019',
      name: '测试学生',
      className: '一班',
    });
    expect(parsed.errors).toEqual([]);
    await expect(
      parseRosterXlsx(bytes, 'mapped.xlsx', 'TEACHER', { 班级: 1, 学号: 1, 学生姓名: 2 }),
    ).rejects.toThrow('XLSX_COLUMN_MAPPING_INVALID');
  });
  it('IM02: preflight changes no formal accounts and requires explicit teacher mapping', async () => {
    const count = await prisma.user.count({ where: { schoolId } });
    const result = await previewRosterImport(root, {
      schoolId,
      offeringId,
      kind: 'SCHOOL',
      filename: 'students.xlsx',
      bytes: await rosterTemplate('SCHOOL'),
    });
    expect(await prisma.user.count({ where: { schoolId } })).toBe(count);
    expect('analysis' in result && result.analysis?.errors.length).toBe(1);
    expect('id' in result).toBe(true);
    batchId = 'id' in result ? result.id : '';
  });
  it('IM03/07: confirmed batch resumes idempotently with one teacher, class, student and credential each', async () => {
    const mapped = await mapRosterImport(root, batchId, {
      version: 2,
      teachers: { 张老师: { createName: '张老师', confirmed: true } },
      classes: {},
      rowGroups: {},
    });
    const input = {
      importBatchId: batchId,
      fingerprint: mapped.fingerprint,
      mappingVersion: 2,
      rosterVersion: mapped.rosterVersion,
    };
    await Promise.all([commitRosterImport(root, input), commitRosterImport(root, input)]);
    await executeRosterImport(batchId);
    await executeRosterImport(batchId);
    const status = await rosterImportStatus(root, batchId);
    expect(status.status).toBe('SUCCEEDED');
    credentialBatchId = (status.result as { credentialBatchId: string }).credentialBatchId;
    expect(await prisma.user.count({ where: { schoolId, kind: 'TEACHER' } })).toBe(1);
    expect(
      await prisma.user.count({ where: { schoolId, kind: 'STUDENT', studentNumber: '00123456' } }),
    ).toBe(1);
    expect(
      await prisma.credentialDeliveryItem.count({ where: { batchId: credentialBatchId } }),
    ).toBe(2);
  });
  it('IM05/06: separate real workbooks, one-use tickets, changed-password credentials unavailable', async () => {
    const teacherTicket = await prepareCredentialDownload(
      root,
      credentialBatchId,
      'TEACHER',
      proof,
    );
    const teacherFile = await downloadCredentials(root, teacherTicket.token);
    expect(teacherFile.filename).toBe('teacher-initial-credentials.xlsx');
    await expect(downloadCredentials(root, teacherTicket.token)).rejects.toThrow(
      'DOWNLOAD_EXPIRED',
    );
    const ticket = await prepareCredentialDownload(root, credentialBatchId, 'STUDENT', proof),
      file = await downloadCredentials(root, ticket.token);
    expect(file.filename).toBe('student-initial-credentials.xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.bytes as unknown as ExcelJS.Buffer);
    expect(wb.worksheets[0].getCell('D3').value).toBe('00123456');
    const temporary = String(wb.worksheets[0].getCell('F3').value),
      student = await prisma.user.findUniqueOrThrow({
        where: { schoolId_studentNumber: { schoolId, studentNumber: '00123456' } },
      });
    await changeOwnPassword(
      await loadIdentity(student.id, 'STUDENT', 0, true),
      temporary,
      'New-Student-Password-2026!',
    );
    const summary = await listCredentialDeliveries(root, schoolId);
    expect(
      summary.items
        .find((b) => b.id === credentialBatchId)
        ?.kinds.find((k) => k.kind === 'STUDENT'),
    ).toMatchObject({ available: 0, unavailable: 1 });
    expect(JSON.stringify(summary)).not.toMatch(/ciphertext|password|secretId/);
    const after = await prepareCredentialDownload(root, credentialBatchId, 'STUDENT', proof);
    await expect(downloadCredentials(root, after.token)).rejects.toThrow(
      'NO_AVAILABLE_INITIAL_CREDENTIALS',
    );
    const secret = await prisma.credentialDeliveryItem.findFirstOrThrow({
      where: { accountId: student.id },
    });
    expect(
      (await prisma.secretRecord.findUniqueOrThrow({ where: { id: secret.secretId } })).ciphertext,
    ).toBe('');
  });
  it('IM06/ID09: expired links, delivery windows and reset credentials cannot be reused', async () => {
    const teacher = await createTeacher(root, { schoolId, name: '短期凭据测试' });
    const first = await prepareCredentialDownload(
      root,
      teacher.credentialBatchId,
      'TEACHER',
      proof,
    );
    await prisma.credentialDownload.update({
      where: { id: securityDigest(first.token) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(downloadCredentials(root, first.token)).rejects.toThrow('DOWNLOAD_EXPIRED');
    const pending = await prepareCredentialDownload(
      root,
      teacher.credentialBatchId,
      'TEACHER',
      proof,
    );
    const reset = await resetAccountPassword(root, teacher.id, proof);
    await expect(downloadCredentials(root, pending.token)).rejects.toThrow(
      'NO_AVAILABLE_INITIAL_CREDENTIALS',
    );
    await expect(loadIdentity(teacher.id, 'STAFF', 0, true)).rejects.toThrow('SESSION_REVOKED');
    const current = await prepareCredentialDownload(
      root,
      reset.credentialBatchId,
      'TEACHER',
      proof,
    );
    expect((await downloadCredentials(root, current.token)).bytes.length).toBeGreaterThan(1000);
    const summary = await listCredentialDeliveries(root, schoolId);
    expect(
      summary.items
        .find((b) => b.id === teacher.credentialBatchId)
        ?.kinds.find((k) => k.kind === 'TEACHER'),
    ).toMatchObject({ available: 0, unavailable: 1 });
    expect(
      summary.items
        .find((b) => b.id === reset.credentialBatchId)
        ?.kinds.find((k) => k.kind === 'TEACHER'),
    ).toMatchObject({ available: 1, unavailable: 0 });
    await prisma.credentialDeliveryBatch.update({
      where: { id: reset.credentialBatchId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(
      prepareCredentialDownload(root, reset.credentialBatchId, 'TEACHER', proof),
    ).rejects.toThrow('CREDENTIAL_DELIVERY_EXPIRED');
    const expired = (await listCredentialDeliveries(root, schoolId)).items.find(
      (b) => b.id === reset.credentialBatchId,
    );
    expect(expired).toMatchObject({ expired: true });
    expect(expired?.kinds.find((k) => k.kind === 'TEACHER')).toMatchObject({
      available: 0,
      unavailable: 1,
    });
  });
  it('ID10: teacher cannot create another teacher or attach a cross-school class', async () => {
    const created = await createTeacher(root, { schoolId, name: '另一个教师' });
    const u = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
    const actor: Actor = {
      id: u.id,
      name: u.name,
      kind: 'TEACHER',
      schoolId,
      realm: 'STAFF',
      roles: ['TEACHER'],
    };
    await expect(createTeacher(actor, { schoolId, name: '越权' })).rejects.toThrow(
      'IDENTITY_FORBIDDEN',
    );
    const otherSchool = (
      await createSchoolWithAdmin(
        root,
        { name: '隔离学校-' + tag, administratorName: '隔离管理员' },
        proof,
      )
    ).school.id;
    await expect(
      createClass(actor, { schoolId: otherSchool, offeringId, name: '越权班', teacherId: u.id }),
    ).rejects.toThrow('SCHOOL_FORBIDDEN');
  });
});
