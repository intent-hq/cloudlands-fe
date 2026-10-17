import { rendererEventRecovery } from '$features/events/renderer-event-recovery';

export const GLOBAL_SETTINGS_RECOVERY_KEY = 'settings:global';
export const GLOBAL_MCP_RECOVERY_KEY = 'mcp:global';
let generation = {};
let admitted = true;
const pendingReads = new Map<string, Set<Promise<unknown>>>();
const authorityFailures = new Set<() => void>();

/** The current settings owner clears all protected mirrors on a strict read denial. */
export function onSettingsAuthorityFailure(handler: () => void): () => void {
  authorityFailures.add(handler);
  return () => {
    authorityFailures.delete(handler);
  };
}
export function reportSettingsAuthorityFailure(): undefined {
  for (const handler of [...authorityFailures]) handler();
  return undefined;
}

/** Recovery waits for ordinary reads already occupying this resource. */
export function trackSettingsRead<T>(key: string, read: () => Promise<T>): Promise<T> {
  let reads = pendingReads.get(key);
  if (!reads) {
    reads = new Set();
    pendingReads.set(key, reads);
  }
  const captured = reads;
  const pending = read();
  captured.add(pending);
  const release = () => {
    captured.delete(pending);
    if (!captured.size && pendingReads.get(key) === captured) pendingReads.delete(key);
  };
  void pending.then(release, release);
  return pending;
}
export async function waitForSettingsReads(key: string): Promise<void> {
  await Promise.allSettled([...(pendingReads.get(key) ?? [])]);
}

/** Also fences legacy reads and queues before a recovery session is attached. */
export function retireSettingsWork(allowNewWork = true): void {
  generation = {};
  admitted = allowNewWork;
  if (!allowNewWork) pendingReads.clear();
}

export function captureSettingsWork(key = GLOBAL_SETTINGS_RECOVERY_KEY) {
  const epoch = generation;
  const receipt = rendererEventRecovery.capture(key);
  return {
    isCurrent: () => admitted && epoch === generation && receipt.commit(() => {}),
    // Form snapshots merge intervening field pushes, but never cross loss or authority.
    isSameScope: () => {
      const current = rendererEventRecovery.capture(key);
      return (
        admitted && epoch === generation && receipt.key === current.key && current.commit(() => {})
      );
    },
  };
}

/** Only canonical protocol authority/absence errors may clear protected state. */
export function isSettingsAuthorityError(error: unknown): boolean {
  const failure = error as { rpcCode?: unknown; data?: { code?: unknown } } | null;
  return (
    failure?.rpcCode === -32003 ||
    failure?.rpcCode === -32001 ||
    (failure?.rpcCode === -32602 && failure.data?.code === 'not-found')
  );
}
