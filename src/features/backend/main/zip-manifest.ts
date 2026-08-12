/**
 * Minimal zip central-directory reader for the import-from-file flow: pulls
 * `manifest.json` out of a transfer archive without extracting anything else
 * and without a zip dependency. Supports stored (0) and deflated (8) entries
 * plus the zip64 EOCD shapes the daemon's zip writer may emit.
 */

import { inflateRawSync } from 'node:zlib';

const EOCD_SIG = 0x06054b50;
const EOCD64_LOCATOR_SIG = 0x07064b50;
const EOCD64_SIG = 0x06064b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

/** Random-access reader seam (a file handle in production, Buffer in tests). */
export interface ZipByteSource {
  size(): Promise<number>;
  /** Read exactly `length` bytes at `offset`. */
  read(offset: number, length: number): Promise<Buffer>;
}

interface CentralEntry {
  fileName: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

/** Locate the EOCD record scanning back over a possible zip comment. */
async function findEocd(source: ZipByteSource): Promise<Buffer> {
  const size = await source.size();
  const maxScan = Math.min(size, 22 + 65535);
  if (size < 22) throw new Error('not a zip archive (too small)');
  const tail = await source.read(size - maxScan, maxScan);
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === EOCD_SIG) return tail.subarray(i);
  }
  throw new Error('not a zip archive (no end-of-central-directory record)');
}

/** Central directory offset + entry count, following zip64 when flagged. */
async function centralDirectory(
  source: ZipByteSource,
  eocd: Buffer,
): Promise<{ offset: number; count: number }> {
  let count = eocd.readUInt16LE(10);
  let offset = eocd.readUInt32LE(16);
  if (offset !== 0xffffffff && count !== 0xffff) return { offset, count };
  // zip64: locator sits immediately before the EOCD record.
  const size = await source.size();
  const eocdPos = size - eocd.length;
  const locator = await source.read(eocdPos - 20, 20);
  if (locator.readUInt32LE(0) !== EOCD64_LOCATOR_SIG) {
    throw new Error('zip64 archive without an EOCD64 locator');
  }
  const eocd64Pos = Number(locator.readBigUInt64LE(8));
  const eocd64 = await source.read(eocd64Pos, 56);
  if (eocd64.readUInt32LE(0) !== EOCD64_SIG) {
    throw new Error('invalid zip64 end-of-central-directory record');
  }
  count = Number(eocd64.readBigUInt64LE(32));
  offset = Number(eocd64.readBigUInt64LE(48));
  return { offset, count };
}

/** Parse central-directory entries until `fileName` is found. */
function findEntry(directory: Buffer, count: number, fileName: string): CentralEntry | null {
  let pos = 0;
  for (let i = 0; i < count && pos + 46 <= directory.length; i++) {
    if (directory.readUInt32LE(pos) !== CENTRAL_SIG) break;
    const compressionMethod = directory.readUInt16LE(pos + 10);
    let compressedSize = directory.readUInt32LE(pos + 20);
    let uncompressedSize = directory.readUInt32LE(pos + 24);
    const nameLength = directory.readUInt16LE(pos + 28);
    const extraLength = directory.readUInt16LE(pos + 30);
    const commentLength = directory.readUInt16LE(pos + 32);
    let localHeaderOffset = directory.readUInt32LE(pos + 42);
    const name = directory.toString('utf8', pos + 46, pos + 46 + nameLength);
    if (name === fileName) {
      // zip64 extra field (0x0001) carries the 64-bit sizes/offset in the
      // order of the fields that overflowed 0xFFFFFFFF.
      let extraPos = pos + 46 + nameLength;
      const extraEnd = extraPos + extraLength;
      while (extraPos + 4 <= extraEnd) {
        const headerId = directory.readUInt16LE(extraPos);
        const dataSize = directory.readUInt16LE(extraPos + 2);
        if (headerId === 0x0001) {
          let fieldPos = extraPos + 4;
          if (uncompressedSize === 0xffffffff) {
            uncompressedSize = Number(directory.readBigUInt64LE(fieldPos));
            fieldPos += 8;
          }
          if (compressedSize === 0xffffffff) {
            compressedSize = Number(directory.readBigUInt64LE(fieldPos));
            fieldPos += 8;
          }
          if (localHeaderOffset === 0xffffffff) {
            localHeaderOffset = Number(directory.readBigUInt64LE(fieldPos));
          }
          break;
        }
        extraPos += 4 + dataSize;
      }
      return { fileName: name, compressionMethod, compressedSize, uncompressedSize, localHeaderOffset };
    }
    pos += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

/**
 * Read one file's bytes out of a zip archive via its central directory.
 * Returns null when the archive has no entry with that exact name.
 */
export async function readZipEntry(source: ZipByteSource, fileName: string): Promise<Buffer | null> {
  const eocd = await findEocd(source);
  const { offset, count } = await centralDirectory(source, eocd);
  const size = await source.size();
  const directory = await source.read(offset, size - eocd.length - offset);
  const entry = findEntry(directory, count, fileName);
  if (!entry) return null;
  // Local header: name/extra lengths there may differ from the central copy.
  const local = await source.read(entry.localHeaderOffset, 30);
  if (local.readUInt32LE(0) !== LOCAL_SIG) {
    throw new Error(`invalid local file header for ${fileName}`);
  }
  const nameLength = local.readUInt16LE(26);
  const extraLength = local.readUInt16LE(28);
  const dataOffset = entry.localHeaderOffset + 30 + nameLength + extraLength;
  const compressed = await source.read(dataOffset, entry.compressedSize);
  if (entry.compressionMethod === 0) return compressed;
  if (entry.compressionMethod === 8) return inflateRawSync(compressed);
  throw new Error(`unsupported zip compression method ${entry.compressionMethod} for ${fileName}`);
}

/** Parse `manifest.json` from a transfer archive. */
export async function readZipManifest(source: ZipByteSource): Promise<unknown> {
  const bytes = await readZipEntry(source, 'manifest.json');
  if (!bytes) throw new Error('archive has no manifest.json — not a workspace transfer archive');
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    throw new Error('archive manifest.json is not valid JSON');
  }
}
