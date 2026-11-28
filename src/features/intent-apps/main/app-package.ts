/**
 * Read an app package that the user picked or dropped (spec 12): a
 * `.intentapp` or `.zip` file is sent as is; a folder is zipped here first,
 * with its files at the zip root. The daemon of the window's machine unpacks
 * and checks it (`docs/protocol/methods/apps.md`), so this module only refuses
 * what the daemon would refuse anyway before it reads or sends any content:
 * symlinks and bundles over the file count or size limits.
 */
import { promises as fs } from 'fs';
import path from 'path';
import yazl from 'yazl';

/** The bundle limits of the contract ("App format"). */
const MAX_FILES = 2000;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
/** The largest package the daemon accepts as uploaded ("Package upload"). */
const MAX_PACKAGE_BYTES = 80 * 1024 * 1024;
const PACKAGE_EXTENSIONS = ['.intentapp', '.zip'];

export interface AppPackage {
  /** The package file name (a folder gets `<folder>.intentapp`). */
  fileName: string;
  /** The zip bytes. */
  bytes: Buffer;
}

class AppPackageError extends Error {
  readonly data: { code: string };
  constructor(code: string, message: string) {
    super(message);
    this.data = { code };
  }
}

/** Whether a path names a package file (by extension) the picker and drop accept. */
function isAppPackageFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return PACKAGE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

async function listBundle(root: string): Promise<{ relative: string; absolute: string }[]> {
  const files: { relative: string; absolute: string }[] = [];
  let total = 0;
  const walk = async (dir: string, prefix: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) {
        throw new AppPackageError('invalid-bundle', `symlinks are not allowed: ${relative}`);
      }
      if (entry.isDirectory()) {
        await walk(absolute, relative);
        continue;
      }
      if (!entry.isFile()) continue;
      const { size } = await fs.stat(absolute);
      total += size;
      if (size > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES) {
        throw new AppPackageError('bundle-too-large', `the app is too large: ${relative}`);
      }
      files.push({ relative, absolute });
      if (files.length > MAX_FILES) {
        throw new AppPackageError('bundle-too-large', 'the app has too many files');
      }
    }
  };
  await walk(root, '');
  return files;
}

async function zipFolder(root: string): Promise<Buffer> {
  const files = await listBundle(root);
  const zip = new yazl.ZipFile();
  for (const file of files) {
    zip.addBuffer(await fs.readFile(file.absolute), file.relative, { compress: true });
  }
  zip.end();
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    zip.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.on('end', () => resolve());
    zip.outputStream.on('error', reject);
  });
  return Buffer.concat(chunks);
}

/** Read the package at `filePath`: a package file as is, a folder zipped. */
export async function readAppPackage(filePath: string): Promise<AppPackage> {
  let stat;
  try {
    stat = await fs.lstat(filePath);
  } catch {
    throw new AppPackageError('not-found', `not found: ${filePath}`);
  }
  if (stat.isDirectory()) {
    return { fileName: `${path.basename(filePath)}.intentapp`, bytes: await zipFolder(filePath) };
  }
  if (!stat.isFile() || !isAppPackageFile(filePath)) {
    throw new AppPackageError('not-a-package', `not an app package: ${path.basename(filePath)}`);
  }
  if (stat.size > MAX_PACKAGE_BYTES) {
    throw new AppPackageError('bundle-too-large', 'the app is too large');
  }
  return { fileName: path.basename(filePath), bytes: await fs.readFile(filePath) };
}
