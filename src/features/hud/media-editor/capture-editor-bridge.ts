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
  dispose(): void;
}

export function connectDockCaptureEditor(
  onSnapshot: (snapshot: DockCaptureEditorSnapshot | null) => void,
): DockCaptureEditorBridge {
  if (!isElectron()) {
    onSnapshot(null);
    return { close: () => {}, dispose: () => {} };
  }
  let disposed = false;
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
    close: (openId) =>
      void electronAPI()
        .invoke(DOCK_CAPTURE_EDITOR_CHANNELS.CLOSE, { openId })
        .catch(() => false),
    dispose: () => {
      disposed = true;
      document.removeEventListener('DOMContentLoaded', changed);
      electronAPI().off(DOCK_CAPTURE_EDITOR_CHANNELS.CHANGED, changed);
    },
  };
}
