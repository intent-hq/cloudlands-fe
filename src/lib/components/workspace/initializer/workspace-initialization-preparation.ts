import type { WorkspaceInitializationPreparationSnapshot } from '$store/renderer/slices/workspace-initializer/workspace-initializer-types';

type Prepare = () => Promise<WorkspaceInitializationPreparationSnapshot | null>;

const preparations = new Map<string, Prepare>();

/**
 * Register the component-owned edge of submission preparation. Redux carries
 * only the returned id; widget handles and the repo-config scheduler stay out
 * of serializable state and remain owned by the mounted form.
 */
export function registerWorkspaceInitializationPreparation(
  id: string,
  prepare: Prepare,
): () => void {
  preparations.set(id, prepare);
  return () => {
    if (preparations.get(id) === prepare) preparations.delete(id);
  };
}

/** Resolve a registered preparation without transferring ownership of its runtime handles. */
export async function resolveWorkspaceInitializationPreparation(
  id: string,
): Promise<WorkspaceInitializationPreparationSnapshot | null> {
  const prepare = preparations.get(id);
  if (!prepare) return null;
  return prepare();
}

export function releaseWorkspaceInitializationPreparation(id: string): void {
  preparations.delete(id);
}
