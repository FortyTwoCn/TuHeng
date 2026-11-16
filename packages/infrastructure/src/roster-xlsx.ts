import ExcelJS from 'exceljs';
import { fromBuffer } from 'yauzl';
import { ensure } from '@tuheng/domain';
import { RosterRow } from '@tuheng/contracts';

export const rosterHeaders = (kind: 'SCHOOL' | 'TEACHER') =>
  kind === 'SCHOOL' ? ['教师名', '班级', '学号', '学生姓名'] : ['班级', '学号', '学生姓名'];
export async function rosterTemplate(kind: 'SCHOOL' | 'TEACHER') {
  const workbook = new ExcelJS.Workbook(),
    sheet = workbook.addWorksheet('学生导入');
  sheet.addRow(rosterHeaders(kind));
  sheet.addRow(
    kind === 'SCHOOL'
      ? ['张老师', '飞设2611', '00123456', '张同学']
      : ['飞设2611', '00123456', '张同学'],
  );
  sheet.columns.forEach((c) => {
    c.width = 24;
    c.numFmt = '@';
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
async function validateZip(bytes: Buffer) {
  ensure(bytes.length <= 5 * 1024 * 1024, 'XLSX_FILE_TOO_LARGE');
  await new Promise<void>((resolve, reject) => {
    fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) {
        reject(new Error('INVALID_XLSX'));
        return;
      }
      let count = 0,
        size = 0;
      const fail = (code: string) => {
        zip.close();
        reject(new Error(code));
      };
      zip.on('error', () => fail('INVALID_XLSX'));
      zip.on('entry', (entry) => {
        size += entry.uncompressedSize;
        count++;
        if (
          count > 200 ||
          size > 25 * 1024 * 1024 ||
          entry.uncompressedSize > 12 * 1024 * 1024 ||
          entry.generalPurposeBitFlag & 1
        )
          return fail('XLSX_ARCHIVE_LIMIT');
        if (/vbaProject|externalLinks|\.bin$/i.test(entry.fileName))
          return fail('XLSX_MACROS_OR_LINKS_FORBIDDEN');
        if (/\.rels$/i.test(entry.fileName)) {
          zip.openReadStream(entry, (err, stream) => {
            if (err || !stream) return fail('INVALID_XLSX');
            let text = '';
            stream.on('data', (c) => {
              text += c.toString();
            });
            stream.on('end', () => {
              if (/TargetMode\s*=\s*["']External["']/i.test(text))
                fail('XLSX_EXTERNAL_LINK_FORBIDDEN');
              else zip.readEntry();
            });
            stream.on('error', () => fail('INVALID_XLSX'));
          });
        } else zip.readEntry();
      });
      zip.on('end', resolve);
      zip.readEntry();
    });
  });
}
export async function parseRosterXlsx(bytes: Buffer, filename: string, kind: 'SCHOOL' | 'TEACHER') {
  ensure(/\.xlsx$/i.test(filename) && !/\.xlsm$/i.test(filename), 'XLSX_REQUIRED');
  await validateZip(bytes);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  ensure(workbook.worksheets.length === 1, 'XLSX_ONE_SHEET_REQUIRED');
  const sheet = workbook.worksheets[0],
    headers = rosterHeaders(kind);
  ensure(sheet.rowCount <= 5001 && sheet.columnCount <= 8, 'XLSX_ROW_OR_COLUMN_LIMIT');
  const actualHeaders = headers.map((_h, i) => sheet.getCell(1, i + 1).text.trim());
  ensure(
    actualHeaders.every((h, i) => h === headers[i]),
    'XLSX_HEADERS_MISMATCH',
  );
  const rows: RosterRow[] = [],
    errors: { row: number; column: string; reason: string }[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const values: string[] = [];
    if (headers.every((_h, i) => sheet.getCell(r, i + 1).value == null)) continue;
    for (let c = 1; c <= headers.length; c++) {
      const cell = sheet.getCell(r, c),
        v = cell.value;
      if (typeof v !== 'string') {
        errors.push({
          row: r,
          column: headers[c - 1],
          reason:
            headers[c - 1] === '学号'
              ? '学号必须是文本；数值可能已丢失前导零或精度，请在 Excel 中修正。'
              : '只接受文本，禁止公式、链接或其他对象。',
        });
        values.push('');
        continue;
      }
      const value = v.trim();
      values.push(value);
      if (
        !value ||
        value.length > 100 ||
        (headers[c - 1] === '学号' && /^[-+]?\d+(\.\d+)?e[+-]?\d+$/i.test(value))
      )
        errors.push({
          row: r,
          column: headers[c - 1],
          reason: '内容为空、过长或学号使用了科学计数法，请修正。',
        });
    }
    const offset = kind === 'SCHOOL' ? 1 : 0;
    const parsed = RosterRow.safeParse({
      row: r,
      teacher: kind === 'SCHOOL' ? values[0] : undefined,
      className: values[offset],
      studentNumber: values[offset + 1],
      name: values[offset + 2],
    });
    if (parsed.success) rows.push(parsed.data);
  }
  ensure(rows.length || errors.length, 'XLSX_EMPTY');
  return { rows, errors };
}
