/**
 * Install an app package on a machine (`docs/protocol/methods/apps.md` →
 * "Package upload", capability `server.capabilities.intentAppPackages: 1`):
 * `file.attachmentUpload.begin { purpose: "app-package" }` with no workspace,
 * the chunks, then `app.install { uploadId }` in place of a commit.
 *
 * One upload serves the check and the install: a dry run (and every failure)
 * keeps the upload, so the install review checks with `dryRun`, may check again
 * with `replace`, and installs the same staged bytes, so the user installs what
 * they reviewed. `file.attachmentUpload.abort` ends an upload the user does not
 * install, and also after an install (it answers `aborted: false` then), which
 * releases the transfer connection of a remote machine.
 */
import { createHash } from 'crypto';
import type { IntentAppInstallResult } from '../../../shared/intent-apps/intent-apps-types';
import type { AppPackage } from './app-package';

/** What the package install needs from the machine's client (`requestRouted` for transfers). */
export type PackageRequest = <T>(method: string, params: Record<string, unknown>) => Promise<T>;

const DEFAULT_CHUNK_BYTES = 16 * 1024 * 1024;

/** Upload a package to the machine; resolves its `uploadId`. Aborts the upload on a failure. */
export async function uploadAppPackage(request: PackageRequest, pkg: AppPackage): Promise<string> {
  const begun = await request<{ uploadId: string; maxChunkBytes?: number }>(
    'file.attachmentUpload.begin',
    {
      purpose: 'app-package',
      fileName: pkg.fileName,
      sizeBytes: pkg.bytes.length,
      sha256: createHash('sha256').update(pkg.bytes).digest('hex'),
    },
  );
  const chunkBytes =
    typeof begun.maxChunkBytes === 'number' && begun.maxChunkBytes > 0
      ? begun.maxChunkBytes
      : DEFAULT_CHUNK_BYTES;
  try {
    for (let seq = 0; seq * chunkBytes < pkg.bytes.length; seq += 1) {
      await request('file.attachmentUpload.chunk', {
        uploadId: begun.uploadId,
        seq,
        data: pkg.bytes.subarray(seq * chunkBytes, (seq + 1) * chunkBytes).toString('base64'),
      });
    }
  } catch (error) {
    await discardAppPackage(request, begun.uploadId);
    throw error;
  }
  return begun.uploadId;
}

/** `app.install` from an uploaded package. A real install also ends the upload. */
export async function installUploadedPackage(
  request: PackageRequest,
  uploadId: string,
  options: { replace?: boolean; dryRun?: boolean },
): Promise<IntentAppInstallResult> {
  const result = await request<IntentAppInstallResult>('app.install', {
    uploadId,
    replace: options.replace === true,
    dryRun: options.dryRun === true,
  });
  if (!options.dryRun) await discardAppPackage(request, uploadId);
  return result;
}

/** End an upload (best effort: the daemon drops idle uploads after 15 minutes). */
export async function discardAppPackage(request: PackageRequest, uploadId: string): Promise<void> {
  await request('file.attachmentUpload.abort', { uploadId }).catch(() => undefined);
}
