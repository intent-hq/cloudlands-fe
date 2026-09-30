/**
 * Transport-lifetime coordination, not UI state. File writes retain their
 * per-path ordering; a Git lease is a workspace file barrier and a root-scoped
 * Git barrier. Reservations survive cancellation/unmount until I/O settles.
 * Acquire once for a composite operation; never call a queued facade inside it.
 */
const fileTails = new Map<string, Map<string, Promise<void>>>();
const gitTails = new Map<string, Map<string, Promise<void>>>();
const versions = new Map<string, number>();

function rootKey(workspaceId: string, gitRootId?: string): string {
  return JSON.stringify([workspaceId, gitRootId ?? '']);
}

export function getGitMutationVersion(workspaceId: string, gitRootId?: string): number {
  return versions.get(rootKey(workspaceId, gitRootId)) ?? 0;
}

export function isGitMutationPending(workspaceId: string, gitRootId?: string): boolean {
  return gitTails.get(workspaceId)?.has(gitRootId ?? '') ?? false;
}

/** Wait through both admitted work and transactions queued while waiting. */
export async function waitForGitMutations(workspaceId: string, gitRootId?: string): Promise<void> {
  for (;;) {
    const tail = gitTails.get(workspaceId)?.get(gitRootId ?? '');
    if (!tail) return;
    await tail;
  }
}

function bumpVersion(workspaceId: string, gitRootId?: string): void {
  const key = rootKey(workspaceId, gitRootId);
  versions.set(key, (versions.get(key) ?? 0) + 1);
}

function retainTail(
  registry: Map<string, Map<string, Promise<void>>>,
  workspaceId: string,
  key: string,
  tail: Promise<void>,
): void {
  const entries = registry.get(workspaceId) ?? new Map<string, Promise<void>>();
  entries.set(key, tail);
  registry.set(workspaceId, entries);
  void tail.then(() => {
    if (entries.get(key) === tail) entries.delete(key);
    if (!entries.size && registry.get(workspaceId) === entries) registry.delete(workspaceId);
  });
}

export function queueFileMutation<T>(
  workspaceId: string,
  relativePath: string,
  run: () => Promise<T>,
): Promise<T> {
  const dependencies = [...(gitTails.get(workspaceId)?.values() ?? [])];
  const previous = fileTails.get(workspaceId)?.get(relativePath);
  if (previous) dependencies.push(previous);
  // Preserve immediate invocation for the uncontended filesystem path.
  const result = dependencies.length ? Promise.all(dependencies).then(run) : run();
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  retainTail(fileTails, workspaceId, relativePath, tail);
  return result;
}

export interface GitMutationLease {
  ready: Promise<void>;
  run<T>(transport: () => Promise<T>): Promise<T>;
  release(): Promise<void>;
}

export function reserveGitMutation(workspaceId: string, gitRootId?: string): GitMutationLease {
  const dependencies = [...(fileTails.get(workspaceId)?.values() ?? [])];
  const previous = gitTails.get(workspaceId)?.get(gitRootId ?? '');
  if (previous) dependencies.push(previous);
  const ready = Promise.all(dependencies).then(() => undefined);
  let complete!: () => void;
  const reservation = new Promise<void>((resolve) => {
    complete = resolve;
  });
  retainTail(gitTails, workspaceId, gitRootId ?? '', reservation);
  bumpVersion(workspaceId, gitRootId);
  let tail = ready;
  let released = false;
  return {
    ready,
    run<T>(transport: () => Promise<T>): Promise<T> {
      if (released) return Promise.reject(new Error('Git mutation lease released'));
      const result = tail.then(transport);
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
    release() {
      if (released) return reservation;
      released = true;
      void tail.then(() => {
        bumpVersion(workspaceId, gitRootId);
        complete();
      });
      return reservation;
    },
  };
}
