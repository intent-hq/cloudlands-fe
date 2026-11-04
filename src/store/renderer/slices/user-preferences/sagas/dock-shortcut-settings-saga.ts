import { buffers } from 'redux-saga';
import { actionChannel, call, cancel, put, take, type SagaGenerator } from 'typed-redux-saga';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import {
  isDockShortcutId,
  isDockShortcutSnapshot,
  type DockShortcutSettingsSnapshot,
} from '$shared/dock-shortcut-settings';
import { store as appStore } from '../../../store';
import { takeEveryFromElectronChannel } from '../../../utils/ipc-channel';
import {
  dockShortcutSettingsReceived,
  dockShortcutPendingSet,
  dockShortcutCaptureRequested,
  dockShortcutCaptureTokenSet,
  dockShortcutErrorSet,
  hydrateShortcutOverrides,
  setShortcutOverride,
  resetShortcutOverride,
  resetAllShortcutOverrides,
} from '../user-preferences-slice';
/** Native-owned settings must bypass the renderer's mock IPC router. */
async function awaitNativeDocumentReady(): Promise<void> {
  if (typeof window === 'undefined' || document.readyState === 'complete') return;
  await new Promise<void>((resolve) =>
    window.addEventListener('load', () => resolve(), { once: true }),
  );
}
async function invokeDockShortcuts(channel: string, payload: unknown): Promise<unknown> {
  const bridge = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (!bridge || typeof bridge.invoke !== 'function')
    throw new Error('Native shortcut settings unavailable');
  return bridge.invoke(channel, payload);
}
function* receive(snapshot: unknown): SagaGenerator<void> {
  if (isDockShortcutSnapshot(snapshot)) yield* put(dockShortcutSettingsReceived(snapshot));
}
function* refresh(): SagaGenerator<void> {
  try {
    const snapshot = yield* call(invokeDockShortcuts, IPC_CHANNELS.DOCK_SHORTCUTS.GET, {
      appOverrides: appStore.state.userPreferences.shortcutOverrides,
    });
    if (!isDockShortcutSnapshot(snapshot)) throw new Error('Shortcut settings unavailable');
    yield* put(dockShortcutSettingsReceived(snapshot));
  } catch {
    yield* put(dockShortcutErrorSet({ code: 'load-failed' }));
  }
}
type ShortcutRequest =
  | ReturnType<typeof setShortcutOverride>
  | ReturnType<typeof resetShortcutOverride>
  | ReturnType<typeof resetAllShortcutOverrides>
  | ReturnType<typeof hydrateShortcutOverrides>
  | ReturnType<typeof dockShortcutCaptureRequested>;
export function* dockShortcutSettingsSaga(): SagaGenerator<void> {
  const requests = yield* actionChannel(
    [
      setShortcutOverride,
      resetShortcutOverride,
      resetAllShortcutOverrides,
      hydrateShortcutOverrides,
      dockShortcutCaptureRequested,
    ],
    buffers.expanding(),
  );
  const updates = yield* takeEveryFromElectronChannel<DockShortcutSettingsSnapshot>(
    IPC_CHANNELS.DOCK_SHORTCUTS.CHANGED,
    receive,
  );
  try {
    // Root components can mount before main has rebound the new document at dom-ready.
    yield* call(awaitNativeDocumentReady);
    yield* refresh();
    while (true) {
      const action = (yield* take(requests)) as ShortcutRequest;
      const capture = action.type === dockShortcutCaptureRequested.type;
      const id = 'payload' in action ? action.payload?.[0] : undefined;
      const resetAll = action.type === resetAllShortcutOverrides.type;
      const globalEdit = resetAll || (typeof id === 'string' && isDockShortcutId(id));
      if (!capture && !globalEdit) {
        yield* refresh();
        continue;
      }
      yield* put(dockShortcutPendingSet(true));
      yield* put(dockShortcutErrorSet(null));
      try {
        const prefs = appStore.state.userPreferences;
        if (capture) {
          const result = (yield* call(invokeDockShortcuts, IPC_CHANNELS.DOCK_SHORTCUTS.CAPTURE, {
            active: !!id,
            token: prefs.dockShortcutCaptureToken ?? undefined,
          })) as { snapshot?: DockShortcutSettingsSnapshot; token?: string | null };
          if (!result || !isDockShortcutSnapshot(result.snapshot))
            throw new Error('Shortcut capture unavailable');
          yield* put(dockShortcutSettingsReceived(result.snapshot));
          yield* put(dockShortcutCaptureTokenSet(result.token ?? null));
        } else {
          if (!prefs.dockShortcuts) throw new Error('Shortcut settings unavailable');
          const request = {
            expectedRevision: prefs.dockShortcuts.revision,
            appOverrides: prefs.shortcutOverrides,
            captureToken: prefs.dockShortcutCaptureToken ?? undefined,
            ...(resetAll
              ? { resetAll: true }
              : {
                  id,
                  key:
                    action.type === setShortcutOverride.type
                      ? (action as ReturnType<typeof setShortcutOverride>).payload[1]
                      : null,
                }),
          };
          const result = yield* call(invokeDockShortcuts, IPC_CHANNELS.DOCK_SHORTCUTS.SET, request);
          if (!isDockShortcutSnapshot(result)) throw new Error('Shortcut settings unavailable');
          yield* put(dockShortcutSettingsReceived(result));
          yield* put(dockShortcutCaptureTokenSet(null));
        }
      } catch {
        yield* put(dockShortcutErrorSet({ code: 'unavailable' }));
        const token = appStore.state.userPreferences.dockShortcutCaptureToken;
        if (token)
          try {
            yield* call(invokeDockShortcuts, IPC_CHANNELS.DOCK_SHORTCUTS.CAPTURE, {
              active: false,
              token,
            });
          } catch {}
        yield* put(dockShortcutCaptureTokenSet(null));
      } finally {
        yield* put(dockShortcutPendingSet(false));
      }
    }
  } finally {
    yield* cancel(updates);
    requests.close();
    const token = appStore.state.userPreferences.dockShortcutCaptureToken;
    if (token)
      try {
        yield* call(invokeDockShortcuts, IPC_CHANNELS.DOCK_SHORTCUTS.CAPTURE, {
          active: false,
          token,
        });
      } catch {}
  }
}
