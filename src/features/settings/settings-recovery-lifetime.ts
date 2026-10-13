import { rendererEventRecovery } from '$features/events/renderer-event-recovery';

export const GLOBAL_SETTINGS_RECOVERY_KEY = 'settings:global';
export const GLOBAL_MCP_RECOVERY_KEY = 'mcp:global';
let generation = {};
let admitted = true;
const pendingReads = new Map<string, Set<Promise<unknown>>>();

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
  };
}
