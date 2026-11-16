import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
export async function writePrivateFile(file: string, content: string | Uint8Array) {
  const resolved = path.resolve(file),
    root = path.resolve('.runtime');
  if (!resolved.startsWith(root + path.sep)) throw new Error('PRIVATE_FILE_MUST_BE_IN_RUNTIME');
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, '', { flag: 'wx', mode: 0o600 });
  try {
    if (process.platform === 'win32') {
      const { stdout } = await promisify(execFile)('whoami.exe', [], { windowsHide: true });
      await promisify(execFile)(
        'icacls.exe',
        [resolved, '/inheritance:r', '/grant:r', `${stdout.trim()}:(F)`, 'SYSTEM:(F)'],
        { windowsHide: true },
      );
    }
    await writeFile(resolved, content, { mode: 0o600 });
  } catch (error) {
    await unlink(resolved);
    throw error;
  }
}
