import { mkdir, mkdtemp, rm, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { inflateRawSync } from 'zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readAppPackage } from './app-package';

/** The entries of a zip (central directory walk), as name → content. */
function unzip(bytes: Buffer): Map<string, string> {
  const files = new Map<string, string>();
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  for (let index = 0; index < count; index += 1) {
    const method = bytes.readUInt16LE(offset + 10);
    const compressed = bytes.readUInt32LE(offset + 20);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const local = bytes.readUInt32LE(offset + 42);
    const name = bytes.toString('utf8', offset + 46, offset + 46 + nameLength);
    const dataStart = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const data = bytes.subarray(dataStart, dataStart + compressed);
    files.set(name, (method === 8 ? inflateRawSync(data) : data).toString('utf8'));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

describe('readAppPackage', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'app-package-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('zips a folder with its files at the zip root', async () => {
    const app = path.join(root, 'side-by-side');
    await mkdir(path.join(app, 'assets'), { recursive: true });
    await writeFile(path.join(app, 'intent-app.json'), '{"id":"side-by-side"}');
    await writeFile(path.join(app, 'index.html'), '<html></html>');
    await writeFile(path.join(app, 'assets', 'app.js'), 'run()');

    const result = await readAppPackage(app);

    expect(result.fileName).toBe('side-by-side.intentapp');
    expect(Object.fromEntries(unzip(result.bytes))).toEqual({
      'assets/app.js': 'run()',
      'index.html': '<html></html>',
      'intent-app.json': '{"id":"side-by-side"}',
    });
  });

  it('sends a package file as it is (.intentapp or .zip, any case)', async () => {
    const zip = path.join(root, 'notes.ZIP');
    await writeFile(zip, 'PK-zip');
    expect((await readAppPackage(zip)).fileName).toBe('notes.ZIP');
    const file = path.join(root, 'Notes.intentapp');
    await writeFile(file, 'PK-bytes');
    expect(await readAppPackage(file)).toEqual({
      fileName: 'Notes.intentapp',
      bytes: Buffer.from('PK-bytes'),
    });
  });

  it('refuses a folder with a symlink, before it sends anything', async () => {
    const app = path.join(root, 'app');
    await mkdir(app);
    await writeFile(path.join(app, 'intent-app.json'), '{}');
    await symlink('/etc/hosts', path.join(app, 'hosts'));
    await expect(readAppPackage(app)).rejects.toMatchObject({
      data: { code: 'invalid-bundle' },
    });
  });

  it('refuses other files and missing paths', async () => {
    const file = path.join(root, 'notes.txt');
    await writeFile(file, 'x');
    await expect(readAppPackage(file)).rejects.toMatchObject({ data: { code: 'not-a-package' } });
    await expect(readAppPackage(path.join(root, 'gone'))).rejects.toMatchObject({
      data: { code: 'not-found' },
    });
  });
});
