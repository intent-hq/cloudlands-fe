import { buffers, channel } from 'redux-saga';

/** One lock per renderer; model/provider and Quick Action writers share this instance. */
export function createBackgroundSettingsWriteLock() {
  const lock = channel<boolean>(buffers.fixed(1));
  lock.put(true);
  return lock;
}
// Svelte compatibility instance; remove at the renderer cutover.
export const backgroundSettingsWriteLock = createBackgroundSettingsWriteLock();
