import { access, readFile, stat } from 'fs/promises';
import { basename, isAbsolute, relative, resolve, sep } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanupDiffTempFiles,
  createDiffTempFiles,
  type DiffTempFiles,
  withDiffTempFiles,
} from '../diff-temp-files.service';

const createdFiles: DiffTempFiles[] = [];

function expectContained(directoryPath: string, filePath: string): void {
  const containedPath = relative(directoryPath, filePath);
  expect(containedPath).not.toBe('');
  expect(containedPath).not.toBe('..');
  expect(containedPath.startsWith(`..${sep}`)).toBe(false);
  expect(isAbsolute(containedPath)).toBe(false);
}

async function create(oldDisplayLabel: string, newDisplayLabel = oldDisplayLabel) {
  const files = await createDiffTempFiles({
    oldContent: 'old content',
    newContent: 'new content',
    oldDisplayLabel,
    newDisplayLabel,
  });
  createdFiles.push(files);
  return files;
}

afterEach(async () => {
  await Promise.all(createdFiles.splice(0).map(cleanupDiffTempFiles));
});

describe('diff temp files', () => {
  it.each([
    ['traversal', '../../outside.ts'],
    ['absolute', resolve(tmpdir(), 'renderer-selected.ts')],
    ['separator-heavy', String.raw`nested/../../mix\\..\\outside.ts`],
  ])('keeps a %s display label separate from generated paths', async (_case, label) => {
    const files = await create(label, `${label}.new`);

    expect(files.oldFile.displayLabel).toBe(label);
    expect(files.newFile.displayLabel).toBe(`${label}.new`);
    expect(basename(files.oldFile.path)).toBe('before');
    expect(basename(files.newFile.path)).toBe('after');
    expectContained(files.directoryPath, files.oldFile.path);
    expectContained(files.directoryPath, files.newFile.path);
    expect(await readFile(files.oldFile.path, 'utf-8')).toBe('old content');
    expect(await readFile(files.newFile.path, 'utf-8')).toBe('new content');
  });

  it('creates mode-restricted directories and files', async () => {
    const files = await create('before.ts', 'after.ts');

    if (process.platform !== 'win32') {
      expect((await stat(files.directoryPath)).mode & 0o777).toBe(0o700);
      expect((await stat(files.oldFile.path)).mode & 0o777).toBe(0o600);
      expect((await stat(files.newFile.path)).mode & 0o777).toBe(0o600);
    }
  });

  it('avoids same-label and concurrent-request collisions', async () => {
    const [first, second] = await Promise.all([create('same.ts'), create('same.ts')]);
    const paths = [
      first.oldFile.path,
      first.newFile.path,
      second.oldFile.path,
      second.newFile.path,
    ];

    expect(new Set(paths).size).toBe(paths.length);
    expect(first.directoryPath).not.toBe(second.directoryPath);
    expect(first.oldFile.path).not.toBe(first.newFile.path);
  });

  it('removes the entire temporary directory from finally when the operation fails', async () => {
    let directoryPath = '';

    await expect(
      withDiffTempFiles(
        {
          oldContent: 'old',
          newContent: 'new',
          oldDisplayLabel: 'before.ts',
          newDisplayLabel: 'after.ts',
        },
        async (files) => {
          directoryPath = files.directoryPath;
          throw new Error('launch failed');
        },
      ),
    ).rejects.toThrow('launch failed');

    await expect(access(directoryPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
