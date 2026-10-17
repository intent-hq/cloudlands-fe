import type { FileContentReadOptions } from '$store/renderer/slices/files/files-types';
import { fileContentRecoveryKey, fileSearchRecoveryKey } from './file-recovery-keys';

// Transport arguments absent from the cached projection. These are demand
// descriptors only; the shared renderer registry owns all recovery lifetimes.
export const fileReadDemands = new Map<string, FileContentReadOptions | undefined>();
export const fileSearchDemands = new Map<string, { requestId: string; query: string }>();
const listeners = new Set<() => void>();
export function onFileRecoveryDemand(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function demandFileRead(
  workspaceId: string,
  path: string,
  options?: FileContentReadOptions,
): void {
  fileReadDemands.set(fileContentRecoveryKey(workspaceId, path), options);
  for (const listener of listeners) listener();
}
export function demandFileSearch(
  workspaceId: string,
  consumerId: string,
  requestId: string,
  query: string,
): void {
  fileSearchDemands.set(fileSearchRecoveryKey(workspaceId, consumerId), { requestId, query });
  for (const listener of listeners) listener();
}
