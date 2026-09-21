import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { createZipFromPaths } from '../zip-utils';

describe('createZipFromPaths', () => {
  let tempDir: string;
  let sourceDir: string;
  let zipPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zip-utils-test-'));
    sourceDir = path.join(tempDir, 'myfolder');
    await fs.mkdir(path.join(sourceDir, 'sub'), { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'top.txt'), 'top');
    await fs.writeFile(path.join(sourceDir, 'sub', 'inner.txt'), 'inner');
    zipPath = path.join(tempDir, 'out.zip');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('adds entries without a prefix by default', async () => {
    await createZipFromPaths(sourceDir, zipPath);

    const buffer = await fs.readFile(zipPath);
    const content = buffer.toString('latin1');
    expect(content).toContain('top.txt');
    expect(content).toContain('sub/inner.txt');
    expect(content).not.toContain('myfolder/top.txt');
  });

  it('prefixes all entries (including nested files) with the root prefix', async () => {
    await createZipFromPaths(sourceDir, zipPath, 'myfolder');

    const buffer = await fs.readFile(zipPath);
    const content = buffer.toString('latin1');
    expect(content).toContain('myfolder/top.txt');
    expect(content).toContain('myfolder/sub/inner.txt');
  });

  it('preserves empty directories (including nested empty-only trees) under the root prefix', async () => {
    await fs.mkdir(path.join(sourceDir, 'emptydir'));
    await fs.mkdir(path.join(sourceDir, 'onlyempties', 'nested'), { recursive: true });

    await createZipFromPaths(sourceDir, zipPath, 'myfolder');

    const buffer = await fs.readFile(zipPath);
    const content = buffer.toString('latin1');
    expect(content).toContain('myfolder/emptydir/');
    expect(content).toContain('myfolder/onlyempties/nested/');
  });
});
