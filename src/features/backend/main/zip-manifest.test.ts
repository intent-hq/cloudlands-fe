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

  it('skips an EOCD signature embedded in the zip comment', async () => {
    // The comment contains the EOCD magic; its comment-length field would not
    // consume the remaining tail, so the scan must keep looking backwards.
    const decoy = Buffer.alloc(30);
    decoy.writeUInt32LE(0x06054b50, 0);
    decoy.write('decoy bytes after sig', 4, 'latin1');
    const zip = buildZip(
      [{ name: 'manifest.json', data: Buffer.from(JSON.stringify(MANIFEST)), method: 0 }],
      decoy.toString('latin1'),
    );
    await expect(readZipManifest(sourceOf(zip))).resolves.toEqual(MANIFEST);
  });

  it('rejects a central-directory offset/size that does not fit before the EOCD', async () => {
    const zip = buildZip([
      { name: 'manifest.json', data: Buffer.from(JSON.stringify(MANIFEST)), method: 0 },
    ]);
    // Corrupt the EOCD's central-directory offset to point near zero while the
    // declared size still claims to run to the EOCD (offset + size > directoryEnd).
    const corrupted = Buffer.from(zip);
    const eocdPos = corrupted.length - 22;
    corrupted.writeUInt32LE(zip.length, eocdPos + 12); // declared directory size too large
    corrupted.writeUInt32LE(0, eocdPos + 16); // offset near zero
    await expect(readZipManifest(sourceOf(corrupted))).rejects.toThrow(
      /invalid zip central directory location/,
    );
  });

  it('rejects an oversized manifest entry before reading its bytes', async () => {
    const zip = buildZip([
      { name: 'manifest.json', data: Buffer.from(JSON.stringify(MANIFEST)), method: 0 },
    ]);
    // Inflate the central directory's declared uncompressed size past the cap.
    const corrupted = Buffer.from(zip);
    const centralOffset = corrupted.readUInt32LE(corrupted.length - 22 + 16);
    corrupted.writeUInt32LE(0x7fffffff, centralOffset + 24);
    await expect(readZipManifest(sourceOf(corrupted))).rejects.toThrow(/too large/);
  });

  it('reads a manifest via the zip64 EOCD64 locator/record and extra field', async () => {
    const data = Buffer.from(JSON.stringify(MANIFEST));
    const name = Buffer.from('manifest.json', 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const centralOffset = 30 + name.length + data.length;
    // Central entry with all three fields deferred to a zip64 extra field
    // (sizes + local header offset all 0xffffffff → three 8-byte values).
    const extra = Buffer.alloc(4 + 24);
    extra.writeUInt16LE(0x0001, 0);
    extra.writeUInt16LE(24, 2);
    extra.writeBigUInt64LE(BigInt(data.length), 4); // uncompressed
    extra.writeBigUInt64LE(BigInt(data.length), 12); // compressed
    extra.writeBigUInt64LE(0n, 20); // local header offset
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(0, 10);
    cen.writeUInt32LE(0xffffffff, 20);
    cen.writeUInt32LE(0xffffffff, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt16LE(extra.length, 30);
    cen.writeUInt32LE(0xffffffff, 42);
    const centralBuf = Buffer.concat([cen, name, extra]);
    const eocd64Pos = centralOffset + centralBuf.length;
    const eocd64 = Buffer.alloc(56);
    eocd64.writeUInt32LE(0x06064b50, 0);
    eocd64.writeBigUInt64LE(1n, 24); // entries on this disk
    eocd64.writeBigUInt64LE(1n, 32); // total entries
    eocd64.writeBigUInt64LE(BigInt(centralBuf.length), 40);
    eocd64.writeBigUInt64LE(BigInt(centralOffset), 48);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeBigUInt64LE(BigInt(eocd64Pos), 8);
    // EOCD with sentinel values pointing at the zip64 structures.
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0xffff, 8);
    eocd.writeUInt16LE(0xffff, 10);
    eocd.writeUInt32LE(0xffffffff, 12);
    eocd.writeUInt32LE(0xffffffff, 16);
    const zip = Buffer.concat([local, name, data, centralBuf, eocd64, locator, eocd]);
    await expect(readZipManifest(sourceOf(zip))).resolves.toEqual(MANIFEST);
  });

  it('falls back to EOCD values when a count sentinel has no zip64 locator', async () => {
    // A non-zip64 archive whose entry count happens to read 0xffff must not
    // be rejected: with no EOCD64 locator the EOCD values are used as-is.
    const zip = buildZip([
      { name: 'manifest.json', data: Buffer.from(JSON.stringify(MANIFEST)), method: 0 },
    ]);
    const corrupted = Buffer.from(zip);
    corrupted.writeUInt16LE(0xffff, corrupted.length - 22 + 10);
    // count only bounds iteration; the directory holds one valid entry.
    await expect(readZipManifest(sourceOf(corrupted))).resolves.toEqual(MANIFEST);
  });

  it('bounds the inflate output even when the declared sizes lie', async () => {
    // A deflated 64 MiB zero-run compresses to a few KiB; forge the central
    // directory sizes to claim it is small so only the inflate bound trips.
    const bomb = deflateRawSync(Buffer.alloc(64 * 1024 * 1024, 0));
    // Build: local header + bomb payload, central dir claiming tiny sizes.
    const name = Buffer.from('manifest.json', 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(bomb.length, 18);
    local.writeUInt32LE(123, 22);
    local.writeUInt16LE(name.length, 26);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(8, 10);
    cen.writeUInt32LE(bomb.length, 20);
    cen.writeUInt32LE(123, 24); // lies: claims 123 bytes uncompressed
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(0, 42);
    const centralBuf = Buffer.concat([cen, name]);
    const dataEnd = 30 + name.length + bomb.length;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(centralBuf.length, 12);
    eocd.writeUInt32LE(dataEnd, 16);
    const forged = Buffer.concat([local, name, bomb, centralBuf, eocd]);
    await expect(readZipManifest(sourceOf(forged))).rejects.toThrow(/too large/);
  });
});
