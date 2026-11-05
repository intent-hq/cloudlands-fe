/**
 * The capture editor window's link to main: read the session (again whenever main
 * says it changed) and ask to close. The window has no app store; this owns its IPC.
 */
import { electronAPI, isElectron } from '$lib/electron-bridge';
import {
  DOCK_CAPTURE_EDITOR_CHANNELS,
  type DockCaptureEditorSnapshot,
} from '$shared/dock-capture-editor';

export interface DockCaptureEditorBridge {
  /** Close the session `openId` names (never a newer one main retargeted to). */
  close(openId: string): void;
  /** Tell main whether the session has unsaved edits (it then asks before losing them). */
  setDirty(openId: string, dirty: boolean): void;
  /** The person's answer to main's question (`onConfirmDiscard`). */
  discard(openId: string): void;
  keep(openId: string): void;
  dispose(): void;
}

export function connectDockCaptureEditor(
  onSnapshot: (snapshot: DockCaptureEditorSnapshot | null) => void,
  /** Main asks before closing or switching would lose the session's edits. */
  onConfirmDiscard: (openId: string) => void = () => {},
): DockCaptureEditorBridge {
  if (!isElectron()) {
    onSnapshot(null);
    const none = () => {};
    return { close: none, setDirty: none, discard: none, keep: none, dispose: none };
  }
  const send = (channel: string, payload: unknown) =>
    void electronAPI()
      .invoke(channel, payload)
      .catch(() => false);

  let disposed = false;
  const confirm = (payload: unknown) => {
    const openId = (payload as { openId?: unknown } | null)?.openId;
    if (!disposed && typeof openId === 'string') onConfirmDiscard(openId);
  };
  electronAPI().on(DOCK_CAPTURE_EDITOR_CHANNELS.CONFIRM_DISCARD, confirm);
  let request = 0;
  const load = async () => {
    const mine = ++request;
    let snapshot: DockCaptureEditorSnapshot | null = null;
    try {
      snapshot =
        ((await electronAPI().invoke(
          DOCK_CAPTURE_EDITOR_CHANNELS.GET,
        )) as DockCaptureEditorSnapshot | null) ?? null;
    } catch {
      snapshot = null;
    }
    // Only the newest read counts.
    if (!disposed && mine === request) onSnapshot(snapshot);
  };
  const changed = () => void load();
  electronAPI().on(DOCK_CAPTURE_EDITOR_CHANNELS.CHANGED, changed);
  // First read once the document is loaded (main binds it then). Main also says
  // CHANGED once it has bound the document, so a read made too early is redone.
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', changed, { once: true });
  else void load();
  return {
    close: (openId) => send(DOCK_CAPTURE_EDITOR_CHANNELS.CLOSE, { openId }),
    setDirty: (openId, dirty) => send(DOCK_CAPTURE_EDITOR_CHANNELS.DIRTY, { openId, dirty }),
    discard: (openId) => send(DOCK_CAPTURE_EDITOR_CHANNELS.DISCARD, { openId }),
    keep: (openId) => send(DOCK_CAPTURE_EDITOR_CHANNELS.KEEP, { openId }),
    dispose: () => {
      disposed = true;
      document.removeEventListener('DOMContentLoaded', changed);
      electronAPI().off(DOCK_CAPTURE_EDITOR_CHANNELS.CHANGED, changed);
      electronAPI().off(DOCK_CAPTURE_EDITOR_CHANNELS.CONFIRM_DISCARD, confirm);
    },
  };
}
