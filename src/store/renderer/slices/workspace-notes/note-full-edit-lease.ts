// Explicit full-document editor lifetimes, separate from paged viewing owners.
// Shared by the read service and the spec-event saga; never persisted.
const editors = new Map<string, Set<number>>();
let nextLeaseId = 0;
export function isFullNoteEditLeaseCurrent(
  workspaceId: string,
  noteId: string,
  id: number,
): boolean {
  return editors.get(JSON.stringify([workspaceId, noteId]))?.has(id) ?? false;
}
export function hasFullNoteEditLease(workspaceId: string, noteId: string): boolean {
  return !!editors.get(JSON.stringify([workspaceId, noteId]))?.size;
}
export function acquireFullNoteEditLease(workspaceId: string, noteId: string) {
  const key = JSON.stringify([workspaceId, noteId]);
  const owner = ++nextLeaseId;
  const owners = editors.get(key) ?? new Set<number>();
  owners.add(owner);
  editors.set(key, owners);
  return {
    id: owner,
    current: () => owners.has(owner),
    release() {
      owners.delete(owner);
      if (!owners.size && editors.get(key) === owners) editors.delete(key);
    },
  };
}

export function invalidateFullNoteEditLeases(workspaceId?: string, noteId?: string): void {
  for (const [key, owners] of editors) {
    if (
      workspaceId === undefined ||
      (JSON.parse(key)[0] === workspaceId &&
        (noteId === undefined || JSON.parse(key)[1] === noteId))
    ) {
      owners.clear();
      editors.delete(key);
    }
  }
}
