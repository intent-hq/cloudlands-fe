// Explicit full-document editor lifetimes, separate from paged viewing owners.
// Shared by the read service and the spec-event saga; never persisted.
const editors = new Map<string, Set<object>>();
export function hasFullNoteEditLease(workspaceId: string, noteId: string): boolean {
  return !!editors.get(JSON.stringify([workspaceId, noteId]))?.size;
}
export function acquireFullNoteEditLease(workspaceId: string, noteId: string) {
  const key = JSON.stringify([workspaceId, noteId]);
  const owner = {};
  const owners = editors.get(key) ?? new Set<object>();
  owners.add(owner);
  editors.set(key, owners);
  return {
    current: () => owners.has(owner),
    release() {
      owners.delete(owner);
      if (!owners.size && editors.get(key) === owners) editors.delete(key);
    },
  };
}
