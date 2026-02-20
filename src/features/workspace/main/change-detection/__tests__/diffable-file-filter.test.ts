/**
 * Tests for diffable-file-filter.ts
 *
 * Tests content-based binary detection end-to-end using real temp files on disk.
 * Verifies isFileDiffable and filterDiffableFiles correctly detect binary content
 * in files with no extension or unrecognized extensions.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { isFileDiffable, filterDiffableFiles } from '../diffable-file-filter';

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'diffable-filter-test-'));
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

/** Helper to write a file and return its relative path */
async function writeTestFile(name: string, content: Buffer | string): Promise<string> {
  const filePath = path.join(tmpDir, name);
  await fs.writeFile(filePath, content);
  return name;
}

describe('isFileDiffable - content-based binary detection', () => {
  it('should detect file with no extension containing null bytes as binary', async () => {
    const content = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x00, 0x00, 0x00, 0x57, 0x6f]);
    const relPath = await writeTestFile('binary-no-ext', content);

    const result = await isFileDiffable(tmpDir, relPath);
    expect(result.isDiffable).toBe(false);
    expect(result.reason).toBe('binary-content');
  });

  it('should detect file with .data extension containing binary content as binary', async () => {
    // Create buffer with >30% non-printable bytes
    const bytes: number[] = [];
    for (let i = 0; i < 60; i++) bytes.push(0x41); // printable
    for (let i = 0; i < 40; i++) bytes.push(0x01); // non-printable
    const relPath = await writeTestFile('model.data', Buffer.from(bytes));

    const result = await isFileDiffable(tmpDir, relPath);
    expect(result.isDiffable).toBe(false);
    expect(result.reason).toBe('binary-content');
  });

  it('should NOT flag .json file with valid JSON content as binary', async () => {
    const content = JSON.stringify({ key: 'value', nested: { arr: [1, 2, 3] } }, null, 2);
    const relPath = await writeTestFile('config.json', content);

    const result = await isFileDiffable(tmpDir, relPath);
    expect(result.isDiffable).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('should NOT flag plain text file with no extension as binary', async () => {
    const content = 'This is a plain text file.\nWith multiple lines.\nNo extension needed.\n';
    const relPath = await writeTestFile('readme', content);

    const result = await isFileDiffable(tmpDir, relPath);
    expect(result.isDiffable).toBe(true);
  });

  it('should NOT flag .json file with unusual UTF-8 content as binary', async () => {
    const content = JSON.stringify({ greeting: 'こんにちは', emoji: '🎉', accent: 'café' });
    const relPath = await writeTestFile('i18n.json', content);

    const result = await isFileDiffable(tmpDir, relPath);
    expect(result.isDiffable).toBe(true);
  });
});

describe('filterDiffableFiles - content-based binary detection', () => {
  it('should filter out binary content files and keep text files', async () => {
    // Binary file (null bytes, no extension)
    const binaryFile = await writeTestFile('filter-binary', Buffer.from([0x00, 0x01, 0x02]));
    // Text file (no extension)
    const textFile = await writeTestFile('filter-text', 'Hello world\n');
    // JSON file (known text extension)
    const jsonFile = await writeTestFile('filter-data.json', '{"ok": true}');

    const result = await filterDiffableFiles(tmpDir, [binaryFile, textFile, jsonFile]);

    expect(result.diffable).toContain(textFile);
    expect(result.diffable).toContain(jsonFile);
    expect(result.diffable).not.toContain(binaryFile);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: binaryFile, reason: 'binary-content' }),
      ]),
    );
  });

  it('should include binary-content reason in skipped array', async () => {
    const binaryFile = await writeTestFile(
      'skip-reason.data',
      Buffer.from(Array(100).fill(0x01)),
    );

    const result = await filterDiffableFiles(tmpDir, [binaryFile]);

    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toBe('binary-content');
    expect(result.skipped[0].path).toBe(binaryFile);
  });
});

