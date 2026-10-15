import type { WorkspaceLocalCreation } from '../workspace-initializer-types';

/** Settings are untrusted input; a recovery receipt never grants authority. */
export function readWorkspaceLocalCreation(value: unknown): WorkspaceLocalCreation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const text = (key: string, max: number) =>
    typeof v[key] === 'string' &&
    (v[key] as string).length > 0 &&
    (v[key] as string).length <= max &&
    !(v[key] as string).includes('\0');
  if (
    !text('id', 128) ||
    !text('authority', 4096) ||
    !text('repositoryPath', 4096) ||
    !text('baseRef', 1024) ||
    !['pending', 'uncertain', 'failure', 'success'].includes(v.status as string)
  )
    return null;
  return {
    id: v.id as string,
    authority: v.authority as string,
    repositoryPath: v.repositoryPath as string,
    baseRef: v.baseRef as string,
    status: v.status as WorkspaceLocalCreation['status'],
    ...(text('error', 8192) ? { error: v.error as string } : {}),
    ...(text('workspaceId', 256) ? { workspaceId: v.workspaceId as string } : {}),
  };
}
