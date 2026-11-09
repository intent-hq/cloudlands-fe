/**
 * The capture editor window's link to main: read the session (again whenever main
 * says it changed) and ask to close. The window has no app store; this owns its IPC.
 */
import { electronAPI, isElectron } from '$lib/electron-bridge';
import { LOG_CHANNELS } from '$shared/ipc/channels';
import {
  DOCK_CAPTURE_EDITOR_CHANNELS,
  type DockCaptureEditorNoteDictationAck,
  type DockCaptureEditorNoteDictationRequest,
  type DockCaptureEditorNoteDictationUpdate,
  type DockCaptureEditorRetakeOutcome,
  type DockCaptureEditorSaveResult,
  type DockCaptureEditorSnapshot,
} from '$shared/dock-capture-editor';
import { DockMediaEditSchema, type DockMediaEdit } from '$shared/dock-media-edit';

export type CaptureEditorSaveFailureStage =
  | 'plan' | 'ack' | 'saved-source' | 'saved-schema' | 'saved-plan' | 'exception' | 'serialize' | 'invoke';
const SAVE_DIAGNOSTIC_REASONS = new Set([
  'stale-source', 'invalid-edit', 'legacy-baked-marks', 'transcript-pending',
  'transcript-unavailable', 'timing-unavailable', 'audio-unavailable', 'failed',
  'revision-conflict', 'invalid-result', 'no-result', 'mismatch',
  'Error', 'TypeError', 'DataCloneError', 'other',
]);

/** Existing logging IPC persists bounded codes even in utility windows without console forwarding. */
export function reportCaptureEditorSaveFailure(stage: CaptureEditorSaveFailureStage, reason: string | readonly string[]): void {
  const reasons = (typeof reason === 'string' ? [reason] : reason).slice(0, 7)
    .map((code) => SAVE_DIAGNOSTIC_REASONS.has(code) ? code : 'other');
  const message = `CaptureEditorSave stage=${stage} reason=${reasons.join(',') || 'other'}`;
  console.warn(message);
  if (!isElectron()) return;
  try {
    void electronAPI().invoke(LOG_CHANNELS.PERSIST_RENDERER_LOGS, [{
      timestamp: new Date().toISOString(), level: 'WARN', category: 'CaptureEditorSave', message,
    }]).then((reply) => {
      if ((reply as { success?: boolean } | undefined)?.success !== true)
        console.warn('CaptureEditorSave persistence=unacknowledged');
    }).catch(() => console.warn('CaptureEditorSave persistence=unavailable'));
  } catch {
    console.warn('CaptureEditorSave persistence=unavailable');
  }
}

export interface DockCaptureEditorBridge {
  /** Close the session `openId` names (never a newer one main retargeted to). */
  close(openId: string): Promise<boolean>;
  /** Finish this capture; older main builds still close safely by openId. */
  attach(openId: string): Promise<boolean>;
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
  /** Start or stop dictating into a mark's note; text arrives via `onNoteUpdate`. */
  noteDictation(
    request: DockCaptureEditorNoteDictationRequest,
  ): Promise<DockCaptureEditorNoteDictationAck>;
  dispose(): void;
}

export function connectDockCaptureEditor(
  onSnapshot: (snapshot: DockCaptureEditorSnapshot | null) => void,
  /**
   * Main asks before closing the window or switching it to another source; the page
   * answers at once without unsaved edits, otherwise after asking the person.
   */
  onConfirmDiscard: (openId: string, requestId: string) => void = () => {},
  /** A note dictation's text (cumulative; the final one ends it). */
  onNoteUpdate: (update: DockCaptureEditorNoteDictationUpdate) => void = () => {},
): DockCaptureEditorBridge {
  if (!isElectron()) {
    onSnapshot(null);
    const none = () => {};
    return {
      close: async () => false,
      attach: async () => false,
      discard: none,
      keep: none,
      save: async () => null,
      retake: async () => null,
      noteDictation: async () => ({ ok: false, error: 'unavailable' }),
      dispose: none,
    };
  }
  const send = (channel: string, payload: unknown) =>
    void electronAPI()
      .invoke(channel, payload)
      .catch(() => false);

  let disposed = false;
  const requestClose = async (payload: { openId: string; intent?: 'attach' }): Promise<boolean> => {
    if (disposed) return false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        electronAPI()
          .invoke(DOCK_CAPTURE_EDITOR_CHANNELS.CLOSE, payload)
          .then((result) => result === true),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), 5000);
        }),
      ]);
    } catch {
      return false;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
  const confirm = (payload: unknown) => {
    const { openId, requestId } = (payload ?? {}) as { openId?: unknown; requestId?: unknown };
    if (!disposed && typeof openId === 'string' && typeof requestId === 'string')
      onConfirmDiscard(openId, requestId);
  };
  electronAPI().on(DOCK_CAPTURE_EDITOR_CHANNELS.CONFIRM_DISCARD, confirm);
  const noteUpdate = (payload: unknown) => {
    if (!disposed && payload && typeof payload === 'object')
      onNoteUpdate(payload as DockCaptureEditorNoteDictationUpdate);
  };
  electronAPI().on(DOCK_CAPTURE_EDITOR_CHANNELS.NOTE_DICTATION_UPDATE, noteUpdate);
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
    close: (openId) => requestClose({ openId }),
    attach: async (openId) => {
      if (await requestClose({ openId, intent: 'attach' })) return true;
      // An older main rejects the optional intent. Retry only the same session;
      // its existing openId guard cannot close a newer attachment.
      return !disposed && (await requestClose({ openId }));
    },
    discard: (openId, requestId) =>
      send(DOCK_CAPTURE_EDITOR_CHANNELS.DISCARD, { openId, requestId }),
    keep: (openId, requestId) => send(DOCK_CAPTURE_EDITOR_CHANNELS.KEEP, { openId, requestId }),
    save: async (openId, edit, replacement) => {
      let stage: 'serialize' | 'invoke' = 'serialize';
      try {
        const canonical = DockMediaEditSchema.parse(edit);
        stage = 'invoke';
        return ((await electronAPI().invoke(DOCK_CAPTURE_EDITOR_CHANNELS.SAVE, {
          openId,
          // Gesture geometry may still be a nested Svelte $state proxy even in
          // the raw edit transaction. The canonical schema validates and builds
          // plain objects/arrays before Electron structured-clones this payload.
          edit: canonical,
          ...(replacement ? { replacement: { candidateToken: replacement.candidateToken } } : {}),
        })) ?? null) as DockCaptureEditorSaveResult | null;
      } catch (cause) {
        const name = cause instanceof Error ? cause.name : '';
        const reason = stage === 'serialize' ? 'invalid-edit'
          : ['Error', 'TypeError', 'DataCloneError'].includes(name) ? name : 'other';
        // Never include the request, pixels, user text, error message or stack.
        reportCaptureEditorSaveFailure(stage, reason);
        return null;
      }
    },
    noteDictation: async (request) => {
      try {
        return ((await electronAPI().invoke(
          DOCK_CAPTURE_EDITOR_CHANNELS.NOTE_DICTATION,
          request,
        )) ?? {
          ok: false,
          error: 'failed',
        }) as DockCaptureEditorNoteDictationAck;
      } catch {
        return { ok: false, error: 'failed' };
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
      electronAPI().off(DOCK_CAPTURE_EDITOR_CHANNELS.NOTE_DICTATION_UPDATE, noteUpdate);
    },
  };
}
