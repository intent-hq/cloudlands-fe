/**
 * Unit tests for the zip central-directory manifest reader. Archives are
 * hand-rolled in memory (stored + deflated entries, trailing comment) so no
 * zip dependency is needed on either side.
 */

import { describe, expect, it } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { readZipEntry, readZipManifest, type ZipByteSource } from './zip-manifest';

interface ZipFile {
  name: string;
  data: Buffer;
  /** 0 = stored, 8 = deflated. */
  method: 0 | 8;
}

/** Build a minimal, valid zip buffer from a list of files. */
function buildZip(files: ZipFile[], comment = ''): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const payload = file.method === 8 ? deflateRawSync(file.data) : file.data;
    // The reader never verifies CRCs, so a zero placeholder keeps the
    // fixture free of a CRC-32 implementation.
    const crc = 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(file.method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, payload);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 6); // version needed
    cen.writeUInt16LE(file.method, 10);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(payload.length, 20);
    cen.writeUInt32LE(file.data.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cen, name]));
    offset += 30 + name.length + payload.length;
  }
  const centralBuf = Buffer.concat(central);
  const commentBuf = Buffer.from(comment, 'utf8');
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(commentBuf.length, 20);
  return Buffer.concat([...parts, centralBuf, eocd, commentBuf]);
}

function sourceOf(zip: Buffer): ZipByteSource {
  return {
    async size() {
      return zip.length;
    },
    async read(off, len) {
      return zip.subarray(off, off + len);
    },
  };
}

const MANIFEST = { formatVersion: 1, workspaceId: 'ws-1', creatingIntentdVersion: '1.2.3' };

describe('readZipEntry / readZipManifest', () => {
  it('reads a stored manifest.json from the central directory', async () => {
    const zip = buildZip([
      { name: 'rows/note.jsonl', data: Buffer.from('{"id":1}\n'), method: 0 },
      { name: 'manifest.json', data: Buffer.from(JSON.stringify(MANIFEST)), method: 0 },
    ]);
    await expect(readZipManifest(sourceOf(zip))).resolves.toEqual(MANIFEST);
  });

  it('inflates a deflated manifest.json', async () => {
    const zip = buildZip([
      { name: 'manifest.json', data: Buffer.from(JSON.stringify(MANIFEST)), method: 8 },
    ]);
    await expect(readZipManifest(sourceOf(zip))).resolves.toEqual(MANIFEST);
  });

  it('finds the EOCD behind a trailing zip comment', async () => {
    const zip = buildZip(
      [{ name: 'manifest.json', data: Buffer.from(JSON.stringify(MANIFEST)), method: 0 }],
      'a comment after the EOCD record',
    );
    await expect(readZipManifest(sourceOf(zip))).resolves.toEqual(MANIFEST);
  });

  it('returns null for a missing entry and errors for a missing manifest', async () => {
    const zip = buildZip([{ name: 'other.txt', data: Buffer.from('x'), method: 0 }]);
    await expect(readZipEntry(sourceOf(zip), 'manifest.json')).resolves.toBeNull();
    await expect(readZipManifest(sourceOf(zip))).rejects.toThrow(/no manifest\.json/);
  });

  it('rejects a non-zip buffer', async () => {
    const junk = Buffer.alloc(64, 0x41);
    await expect(readZipManifest(sourceOf(junk))).rejects.toThrow(/not a zip archive/);
  });

  it('rejects invalid JSON in manifest.json', async () => {
    const zip = buildZip([{ name: 'manifest.json', data: Buffer.from('{nope'), method: 0 }]);
    await expect(readZipManifest(sourceOf(zip))).rejects.toThrow(/not valid JSON/);
  });
});
