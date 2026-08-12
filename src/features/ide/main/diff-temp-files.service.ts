import { chmod, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { isAbsolute, join, relative, resolve, sep } from 'path';

const TEMP_DIRECTORY_PREFIX = 'intent-vscode-diff-';

export interface DiffTempFiles {
  directoryPath: string;
  oldFile: { path: string; displayLabel: string };
  newFile: { path: string; displayLabel: string };
}

interface DiffTempFileInput {
  oldContent: string;
  newContent: string;
  oldDisplayLabel: string;
  newDisplayLabel: string;
}

interface DiffTempFileOptions {
  cleanupDelayMs?: number;
  onCleanupError?: (error: unknown) => void;
}

function assertContained(directoryPath: string, filePath: string): void {
  const containedPath = relative(resolve(directoryPath), resolve(filePath));
  if (
    containedPath === '' ||
    containedPath === '..' ||
    containedPath.startsWith(`..${sep}`) ||
    isAbsolute(containedPath)
  ) {
    throw new Error('Generated diff file path escaped its temporary directory');
  }
}

export async function createDiffTempFiles(input: DiffTempFileInput): Promise<DiffTempFiles> {
  const directoryPath = await mkdtemp(join(tmpdir(), TEMP_DIRECTORY_PREFIX));

  try {
    await chmod(directoryPath, 0o700);
    const oldFilePath = resolve(directoryPath, 'before');
    const newFilePath = resolve(directoryPath, 'after');
    assertContained(directoryPath, oldFilePath);
    assertContained(directoryPath, newFilePath);

    await Promise.all([
      writeFile(oldFilePath, input.oldContent, { encoding: 'utf-8', mode: 0o600, flag: 'wx' }),
      writeFile(newFilePath, input.newContent, { encoding: 'utf-8', mode: 0o600, flag: 'wx' }),
    ]);

    return {
      directoryPath,
      oldFile: { path: oldFilePath, displayLabel: input.oldDisplayLabel },
      newFile: { path: newFilePath, displayLabel: input.newDisplayLabel },
    };
  } catch (error) {
    await rm(directoryPath, { recursive: true, force: true });
    throw error;
  }
}

export async function cleanupDiffTempFiles(files: DiffTempFiles): Promise<void> {
  await rm(files.directoryPath, { recursive: true, force: true });
}

export async function withDiffTempFiles<T>(
  input: DiffTempFileInput,
  operation: (files: DiffTempFiles) => Promise<T>,
  options: DiffTempFileOptions = {},
): Promise<T> {
  let files: DiffTempFiles | undefined;
  let operationSucceeded = false;

  try {
    files = await createDiffTempFiles(input);
    const result = await operation(files);
    operationSucceeded = true;
    return result;
  } finally {
    if (files) {
      const cleanup = () => cleanupDiffTempFiles(files as DiffTempFiles);
      if (operationSucceeded && (options.cleanupDelayMs ?? 0) > 0) {
        setTimeout(() => {
          void cleanup().catch((error) => options.onCleanupError?.(error));
        }, options.cleanupDelayMs);
      } else {
        await cleanup();
      }
    }
  }
}
