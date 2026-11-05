/**
 * The capture editor window's link to main: read the session (again whenever main
 * says it changed) and ask to close. The window has no app store; this owns its IPC.
 */
import { electronAPI, isElectron } from '$lib/electron-bridge';
import {
  DOCK_CAPTURE_EDITOR_CHANNELS,
  type DockCaptureEditorRetakeOutcome,
  type DockCaptureEditorSaveResult,
  type DockCaptureEditorSnapshot,
} from '$shared/dock-capture-editor';
import type { DockMediaEdit } from '$shared/dock-media-edit';

export interface DockCaptureEditorBridge {
  /** Close the session `openId` names (never a newer one main retargeted to). */
  close(openId: string): void;
  /** The answer to main's request `requestId` (`onConfirmDiscard`). */
  discard(openId: string, requestId: string): void;
  keep(openId: string, requestId: string): void;
  /** Save the session's edit; resolves with the durable outcome (failed when unsure). */
  save(
    openId: string,
    edit: DockMediaEdit,
    replacement?: { candidateToken: string },
  ): Promise<DockCaptureEditorSaveResult | null>;
  /** Capture the screenshot again; main hides the editor meanwhile and keeps the result. */
  retake(openId: string): Promise<DockCaptureEditorRetakeOutcome | null>;
  dispose(): void;
}

export function connectDockCaptureEditor(
  onSnapshot: (snapshot: DockCaptureEditorSnapshot | null) => void,
  /**
   * Main asks before closing the window or switching it to another source; the page
   * answers at once without unsaved edits, otherwise after asking the person.
   */
  onConfirmDiscard: (openId: string, requestId: string) => void = () => {},
): DockCaptureEditorBridge {
  if (!isElectron()) {
    onSnapshot(null);
    const none = () => {};
    return {
      close: none,
      discard: none,
      keep: none,
      save: async () => null,
      retake: async () => null,
      dispose: none,
    };
  }
  const send = (channel: string, payload: unknown) =>
    void electronAPI()
      .invoke(channel, payload)
      .catch(() => false);

  let disposed = false;
  const confirm = (payload: unknown) => {
    const { openId, requestId } = (payload ?? {}) as { openId?: unknown; requestId?: unknown };
    if (!disposed && typeof openId === 'string' && typeof requestId === 'string')
      onConfirmDiscard(openId, requestId);
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
    discard: (openId, requestId) =>
      send(DOCK_CAPTURE_EDITOR_CHANNELS.DISCARD, { openId, requestId }),
    keep: (openId, requestId) => send(DOCK_CAPTURE_EDITOR_CHANNELS.KEEP, { openId, requestId }),
    save: async (openId, edit, replacement) => {
      try {
        return ((await electronAPI().invoke(DOCK_CAPTURE_EDITOR_CHANNELS.SAVE, {
          openId,
          edit,
          ...(replacement ? { replacement } : {}),
        })) ?? null) as DockCaptureEditorSaveResult | null;
      } catch {
        return null;
      }
    },
    retake: async (openId) => {
      try {
        return ((await electronAPI().invoke(DOCK_CAPTURE_EDITOR_CHANNELS.RETAKE, { openId })) ??
          null) as DockCaptureEditorRetakeOutcome | null;
      } catch {
        return null;
      }
    },
    dispose: () => {
      disposed = true;
      document.removeEventListener('DOMContentLoaded', changed);
      electronAPI().off(DOCK_CAPTURE_EDITOR_CHANNELS.CHANGED, changed);
      electronAPI().off(DOCK_CAPTURE_EDITOR_CHANNELS.CONFIRM_DISCARD, confirm);
    },
  };
}
