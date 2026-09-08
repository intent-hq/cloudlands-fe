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

/** Upper bound on the central directory we are willing to load (~1.4M entries). */
const MAX_DIRECTORY_BYTES = 64 * 1024 * 1024;
/** Upper bound on a single extracted entry (manifest.json is a few KiB). */
const MAX_ENTRY_BYTES = 16 * 1024 * 1024;

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
    if (tail.readUInt32LE(i) !== EOCD_SIG) continue;
    // Guard against the signature bytes appearing inside a zip comment: the
    // candidate's comment-length field must consume exactly the remaining tail.
    const commentLength = tail.readUInt16LE(i + 20);
    if (i + 22 + commentLength === tail.length) return tail.subarray(i);
  }
  throw new Error('not a zip archive (no end-of-central-directory record)');
}

/** Central directory offset/size + entry count, following zip64 when flagged. */
async function centralDirectory(
  source: ZipByteSource,
  eocd: Buffer,
): Promise<{ offset: number; directorySize: number; count: number }> {
  const size = await source.size();
  let directoryEnd = size - eocd.length; // the EOCD position
  let count = eocd.readUInt16LE(10);
  let directorySize = eocd.readUInt32LE(12);
  let offset = eocd.readUInt32LE(16);
  if (offset === 0xffffffff || count === 0xffff || directorySize === 0xffffffff) {
    // Maybe zip64: the locator sits immediately before the EOCD record. A
    // legitimate non-zip64 archive can hit the count sentinel (exactly 65535
    // entries), so a missing locator falls back to the EOCD values.
    const locator = directoryEnd >= 20 ? await source.read(directoryEnd - 20, 20) : null;
    if (locator && locator.readUInt32LE(0) === EOCD64_LOCATOR_SIG) {
      const eocd64Pos = Number(locator.readBigUInt64LE(8));
      const eocd64 = await source.read(eocd64Pos, 56);
      if (eocd64.readUInt32LE(0) !== EOCD64_SIG) {
        throw new Error('invalid zip64 end-of-central-directory record');
      }
      count = Number(eocd64.readBigUInt64LE(32));
      directorySize = Number(eocd64.readBigUInt64LE(40));
      offset = Number(eocd64.readBigUInt64LE(48));
      directoryEnd = eocd64Pos;
    }
  }
  if (directorySize > MAX_DIRECTORY_BYTES) {
    throw new Error('zip central directory is too large');
  }
  if (offset + directorySize > directoryEnd) {
    throw new Error('invalid zip central directory location');
  }
  return { offset, directorySize, count };
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
      return {
        fileName: name,
        compressionMethod,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
      };
    }
    pos += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

/**
 * Read one file's bytes out of a zip archive via its central directory.
 * Returns null when the archive has no entry with that exact name.
 */
export async function readZipEntry(
  source: ZipByteSource,
  fileName: string,
): Promise<Buffer | null> {
  const eocd = await findEocd(source);
  const { offset, directorySize, count } = await centralDirectory(source, eocd);
  const directory = await source.read(offset, directorySize);
  const entry = findEntry(directory, count, fileName);
  if (!entry) return null;
  if (entry.compressedSize > MAX_ENTRY_BYTES || entry.uncompressedSize > MAX_ENTRY_BYTES) {
    throw new Error(`zip entry ${fileName} is too large`);
  }
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
  if (entry.compressionMethod === 8) {
    // Bound the inflate so a lying size field cannot expand without limit.
    try {
      return inflateRawSync(compressed, { maxOutputLength: MAX_ENTRY_BYTES });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') {
        throw new Error(`zip entry ${fileName} is too large`);
      }
      throw error;
    }
  }
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
