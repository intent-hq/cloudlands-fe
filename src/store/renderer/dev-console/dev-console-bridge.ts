import { devConsoleInvoke } from '$features/dev-console/dev-console-client';
import type { DevConsoleCaptureSelection, DevConsoleUpdate } from '$shared/types/dev-console';

/** One in-flight read, invalidations coalesced, all subscriptions owned by the mounted route. */
export function connectDevConsole(
  onUpdate: (update: DevConsoleUpdate) => void,
  onError: (error: string) => void,
) {
  let stopped = false;
  let sessionId = '';
  let revision = -1;
  let reading = false;
  let dirty = false;
  const read = async () => {
    if (stopped || !sessionId) return;
    if (reading) {
      dirty = true;
      return;
    }
    reading = true;
    try {
      do {
        dirty = false;
        const update = await devConsoleInvoke('dev-console:read', {
          sessionId,
          afterRevision: revision,
        });
        if (stopped) return;
        if (!update) throw new Error('Dev Console session ended');
        revision = update.revision;
        onUpdate(update);
      } while (dirty && !stopped);
    } catch (error) {
      if (!stopped) onError(String(error));
    } finally {
      reading = false;
    }
  };
  const listener = window.electronAPI?.on('dev-console:changed', (event: { sessionId: string }) => {
    if (event.sessionId === sessionId) void read();
  });
  const reloadListener = window.electronAPI?.on('app:reload-request', () =>
    window.location.reload(),
  );
  void devConsoleInvoke('dev-console:connect', {})
    .then((identity) => {
      if (stopped) return;
      sessionId = identity.sessionId;
      return read();
    })
    .catch((error) => {
      if (!stopped) onError(String(error));
    });
  return {
    /** Fetch just the selected retained record; null means evicted/cleared. Do not cache after dispose. */
    record: async (recordId: string) => {
      if (stopped) return null;
      try {
        const record = await devConsoleInvoke('dev-console:record', { sessionId, recordId });
        return stopped ? null : record;
      } catch (error) {
        if (stopped) return null;
        throw error;
      }
    },
    clear: () =>
      stopped ? Promise.resolve(false) : devConsoleInvoke('dev-console:clear', { sessionId }),
    select: (selection: DevConsoleCaptureSelection, enabled: boolean) =>
      stopped
        ? Promise.resolve(false)
        : devConsoleInvoke('dev-console:select', { sessionId, selection, enabled }),
    dispose() {
      stopped = true;
      if (listener) window.electronAPI.offById('dev-console:changed', listener);
      if (reloadListener) window.electronAPI.offById('app:reload-request', reloadListener);
    },
  };
}
