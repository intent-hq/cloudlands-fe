/**
 * UI-side owner for one dock draft pair (workspace + agent + authority).
 *
 * Owns only presentation concerns: the editor insertion flush/acknowledgement,
 * the pre-send drain, preview object URLs, the elapsed-time ticker, dock
 * keyboard shortcuts and action dispatch. The native adapter, speech channel
 * and final-transcript barrier belong to the root native-session saga; this
 * controller requests them through actions and reads their selector mirror.
 * The pure binding projection lives in `dock-composer-presentation.ts`.
 */
import { get, writable, type Readable } from 'svelte/store';
import { store as appStore } from '$store/renderer/store';
import {
  screenReferences,
  type DockMarkTool,
  type DockReferenceEdit,
  undoableDockMark,
  redoableDockMark,
  type EditorScreenReference,
} from '$shared/dock-evidence';
import type { ContextItem } from '$lib/components/chat/input/context-api';
import {
  selectDockComposerEvidence,
  selectDockSpeechStopOutcome,
} from '$store/renderer/slices/dock-conversation/dock-conversation-selectors';
import {
  dockEvidenceAnnotationEndRequested,
  dockEvidenceAnnotationToggleRequested,
  dockEvidenceCaptureRequested,
  dockEvidenceClipRemoveRequested,
  dockEvidenceImageRemoveRequested,
  dockEvidenceInsertionCommitted,
  dockEvidenceMarkUndone,
  dockEvidenceAnnotationUndoRequested,
  dockEvidenceAnnotationRedoRequested,
  dockEvidenceMouseModeRequested,
  dockEvidenceOpenSettingsRequested,
  dockEvidenceRecordToggleRequested,
  dockEvidenceReferencesEdited,
  dockEvidenceToolSelectRequested,
  dockSpeechStartRequested,
  dockSpeechKeepLiveRequested,
  dockSpeechStopRequested,
  dockSpeechToggleRequested,
} from '$store/renderer/slices/dock-conversation/dock-conversation-slice';
import type { DockComposerMediaLabels } from '$features/hud/components/dock-composer-media-presentation';
import type { DockSettingsPane } from './dock-composer-presentation';
import { createDockEvidencePreviewUrl } from './dock-evidence-render';
import { isMacPlatform } from '$lib/utils/shortcuts';
import { matchesShortcut } from '$lib/utils/shortcut-bindings';
import { getPrincipalActionContext } from '$store/renderer/slices/principal/principal-context';

type EvidenceView = ReturnType<typeof selectDockComposerEvidence.select>;

export interface DockComposerScope {
  workspaceId: string;
  agentId: string;
  /** Principal action context; a change retires the controller. */
  authority: string;
}

/** Local, presentation-only state: never synthesized, never persisted. */
export interface DockComposerLocalState {
  now: number;
  previews: Record<string, string>;
}

export interface DockComposerControllerDeps {
  createPreviewUrl: typeof createDockEvidencePreviewUrl;
  revokeUrl: (url: string) => void;
  now: () => number;
  /** Resolves after the editor processed the latest controlled props. */
  tick: () => Promise<void>;
  /** Upper bound for one editor acknowledgement while draining. */
  ackTimeoutMs: number;
  /**
   * Upper bound for one speech stop request: native's 10 s finalization watchdog,
   * its 2 s mark-answer wait, and margin for retried answers. Elapsing fails the
   * send closed; the request may still settle and a retry rejoins the native stop.
   */
  stopTimeoutMs: number;
  /**
   * How long Send waits for the final transcript before it keeps the live words
   * as typed text and sends anyway (never refusing, never dropping words).
   */
  sendStopMs: number;
  /** Platform modifier: ⌘ on macOS, Ctrl elsewhere. */
  mac: () => boolean;
}

const defaultDeps: DockComposerControllerDeps = {
  createPreviewUrl: createDockEvidencePreviewUrl,
  revokeUrl: (url) => URL.revokeObjectURL(url),
  now: () => Date.now(),
  tick: () => new Promise((resolve) => requestAnimationFrame(() => resolve())),
  ackTimeoutMs: 2_000,
  stopTimeoutMs: 20_000,
  sendStopMs: 2_500,
  mac: isMacPlatform,
};

const TOOL_KEYS: Record<string, DockMarkTool> = {
  '1': 'pick',
  '2': 'box',
  '3': 'pen',
  '4': 'arrow',
};
/** Owners of their own Escape/arrow handling (menus, suggestion lists, dialogs). */
const KEY_OWNERS = '[role="listbox"], [role="menu"], [role="dialog"], [role="alertdialog"]';

function isEditable(node: Element | null): boolean {
  return (
    node instanceof HTMLElement &&
    (node.isContentEditable || node.matches('input, textarea, select'))
  );
}

export function createDockComposerController(
  scope: DockComposerScope,
  overrides: Partial<DockComposerControllerDeps> = {},
) {
  const deps = { ...defaultDeps, ...overrides };
  const { workspaceId, agentId } = scope;
  const local = writable<DockComposerLocalState>({ now: deps.now(), previews: {} });
  let disposed = false;
  let ticker: ReturnType<typeof setInterval> | undefined;
  const previewKeys = new Map<string, string>();

  const evidence = (): EvidenceView =>
    selectDockComposerEvidence.select(appStore.state, workspaceId, agentId);
  /**
   * The open conversation is still this pair, and the live principal action
   * context (which includes backend and connection identity) is still the
   * authority this controller was created under; `dock.authority` alone can lag.
   */
  const current = () => {
    const dock = appStore.state.dockConversation;
    return (
      !disposed &&
      dock.workspaceId === workspaceId &&
      dock.agentId === agentId &&
      dock.authority === scope.authority &&
      getPrincipalActionContext(appStore.state) === scope.authority
    );
  };
  const dispatch = (action: Parameters<typeof appStore.dispatch>[0]) => {
    if (current()) appStore.dispatch(action);
  };

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    clearInterval(ticker);
    ticker = undefined;
    for (const url of Object.values(get(local).previews)) deps.revokeUrl(url);
    previewKeys.clear();
  }

  /** Poll the store via `.select` (no readable outside component init) until `done` or the pair retires. */
  async function until(done: () => boolean, bound?: number): Promise<boolean> {
    const polls = bound === undefined ? Infinity : Math.max(1, Math.ceil(bound / 16));
    for (let poll = 0; poll < polls; poll += 1) {
      if (!current()) return false;
      if (done()) return true;
      await new Promise<void>((resolve) => setTimeout(resolve, 16));
    }
    return current() && done();
  }

  /**
   * Ask the native-session saga to stop speech at its final-transcript barrier and
   * wait for that exact request's outcome. True when no speech is live.
   */
  let stopping: Promise<boolean> | null = null;

  /**
   * One stop at a time from this controller: Send, Escape and hold-release share
   * the same request and its outcome instead of racing separate requests.
   */
  function stopSpeech(): Promise<boolean> {
    stopping ??= requestStop().finally(() => {
      stopping = null;
    });
    return stopping;
  }

  async function requestStop(): Promise<boolean> {
    if (!evidence().speech.active) return true;
    const requestId = crypto.randomUUID();
    dispatch(dockSpeechStopRequested(workspaceId, agentId, requestId));
    // Gate on this exact request's own settlement (kept per request, so another stop
    // cannot overwrite it); a failed or error-ended stop also leaves speech inactive,
    // so inactivity alone never passes. Bounded and fail-closed; retirement ends it too.
    const outcome = () => selectDockSpeechStopOutcome.select(appStore.state, requestId);
    const settled = await until(() => outcome() !== null, deps.stopTimeoutMs);
    return settled && outcome()?.ok === true;
  }

  // -------------------------------------------------------------------------
  // Editor handshake and the pre-send barrier
  // -------------------------------------------------------------------------

  /** Exactly-once commit of the head insertion against the mirrored draft revision. */
  function insertionApplied(id: string, committedText: string): void {
    dispatch(
      dockEvidenceInsertionCommitted(
        workspaceId,
        agentId,
        id,
        committedText,
        evidence().draftRevision,
      ),
    );
  }

  /** Wait until the head insertion changes (acknowledged) or the bound elapses. */
  const headChanged = (head: string) =>
    until(() => evidence().insertions[0]?.id !== head, deps.ackTimeoutMs);

  /**
   * Narration naming a native gesture still in flight waits for its explicit
   * settlement (accepted → ready, rejected → that chip dropped). Bounded.
   */
  async function inFlightSettled(): Promise<boolean> {
    const queued = evidence().insertionsQueued;
    return until(() => {
      const view = evidence();
      return view.insertions.length > 0 || view.insertionsQueued !== queued;
    }, deps.ackTimeoutMs);
  }

  /**
   * Stop speech at its final-transcript barrier, then let the editor commit
   * one queued insertion per controlled echo. False keeps the draft intact.
   */
  async function beforeSubmit(flush: () => boolean): Promise<boolean> {
    if (!current()) return false;
    // Wait (bounded) for the final transcript. If it does not arrive in time or the
    // stop fails, keep the live words as typed text and send: Send never drops words.
    const stopped = await Promise.race([
      stopSpeech(),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), deps.sendStopMs)),
    ]);
    if (!stopped) {
      dispatch(dockSpeechKeepLiveRequested(workspaceId, agentId));
      const ended = () => !evidence().speech.active && !evidence().speech.pending;
      if (!(await until(() => ended() && !evidence().dictation, deps.ackTimeoutMs))) return false;
    }
    for (let guard = 0; guard < 64; guard += 1) {
      if (!current()) return false;
      const head = evidence().insertions[0]?.id;
      if (!head) {
        if (evidence().insertionsQueued === 0) break;
        if (!(await inFlightSettled())) return false;
        continue;
      }
      await deps.tick();
      flush();
      if (!(await headChanged(head))) return false;
    }
    if (!current()) return false;
    const view = evidence();
    return (
      !view.speech.active &&
      !view.speech.pending &&
      view.insertionsQueued === 0 &&
      !view.dictation &&
      !view.capturePending &&
      !view.clips.some((clip) => clip.status === 'recording' || clip.status === 'placing')
    );
  }

  // -------------------------------------------------------------------------
  // Previews (object URLs owned and revoked here)
  // -------------------------------------------------------------------------

  async function refreshPreviews(view: EvidenceView, items: readonly ContextItem[]): Promise<void> {
    const wanted = new Set<string>();
    for (const tile of view.tiles) {
      const key = JSON.stringify(tile.marks.map(({ n, mark }) => [n, mark.id, mark.geometry]));
      wanted.add(tile.image.id);
      if (previewKeys.get(tile.image.id) === key) continue;
      const item = items.find((row) => row.id === tile.image.contextItemId);
      if (!item?.imageData || !item.imageMimeType) continue;
      previewKeys.set(tile.image.id, key);
      try {
        const url = await deps.createPreviewUrl(
          { base64: item.imageData, mimeType: item.imageMimeType },
          tile.image,
          tile.marks,
        );
        if (disposed || previewKeys.get(tile.image.id) !== key) {
          deps.revokeUrl(url);
          continue;
        }
        const previous = get(local).previews[tile.image.id];
        local.update((state) => ({
          ...state,
          previews: { ...state.previews, [tile.image.id]: url },
        }));
        if (previous) deps.revokeUrl(previous);
      } catch {
        previewKeys.delete(tile.image.id);
      }
    }
    const stale = Object.entries(get(local).previews).filter(([id]) => !wanted.has(id));
    if (stale.length) {
      local.update((state) => {
        const previews = { ...state.previews };
        for (const [id] of stale) delete previews[id];
        return { ...state, previews };
      });
      for (const [id, url] of stale) {
        previewKeys.delete(id);
        deps.revokeUrl(url);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Actions routed from presentation
  // -------------------------------------------------------------------------

  const actions = {
    onCapture: () => dispatch(dockEvidenceCaptureRequested(workspaceId, agentId)),
    // Stops the live recording, or starts another one beside the finished clips.
    onRecordToggle: () => dispatch(dockEvidenceRecordToggleRequested(workspaceId, agentId)),
    onAnnotationToggle: () => dispatch(dockEvidenceAnnotationToggleRequested(workspaceId, agentId)),
    onToolSelect: (tool: DockMarkTool) =>
      dispatch(dockEvidenceToolSelectRequested(workspaceId, agentId, tool)),
    onDictationToggle: () => dispatch(dockSpeechToggleRequested(workspaceId, agentId)),
    onDictationHoldStart: () => dispatch(dockSpeechStartRequested(workspaceId, agentId)),
    onDictationHoldEnd: () => void stopSpeech(),
    /** User click only: open the OS privacy pane native names (never automatic). */
    onOpenSettings: (pane: DockSettingsPane) =>
      dispatch(dockEvidenceOpenSettingsRequested(workspaceId, agentId, pane)),
    // Tiles carry the canonical ContextItem id; the model's image/clip id is accepted too.
    onMarkUp: (id: string) => {
      const image = imageFor(id);
      if (image) dispatch(dockEvidenceAnnotationToggleRequested(workspaceId, agentId, image.id));
    },
    onRemove: (id: string) => {
      const image = imageFor(id);
      const clip = evidence().clips.find((row) => row.id === id || row.contextItemId === id);
      if (image) dispatch(dockEvidenceImageRemoveRequested(workspaceId, agentId, image.id));
      else if (clip) dispatch(dockEvidenceClipRemoveRequested(workspaceId, agentId, clip.id));
    },
  };

  function imageFor(id: string) {
    return evidence().tiles.find(({ image }) => image.id === id || image.contextItemId === id)
      ?.image;
  }

  const handledKeys = new WeakSet<KeyboardEvent>();

  /**
   * Dock-level shortcuts (window capture phase). Returns true and consumes the
   * event only when it acted. Never consumes IME composition, auto-repeat, an
   * already-handled event, keys aimed at a menu/list/dialog, or editing keys
   * while the field is focused.
   */
  function handleKey(event: KeyboardEvent): boolean {
    if (
      handledKeys.has(event) ||
      event.defaultPrevented ||
      event.isComposing ||
      event.keyCode === 229 ||
      event.repeat ||
      !current()
    )
      return false;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(KEY_OWNERS)) return false;
    const fieldFocused = isEditable(document.activeElement) || isEditable(target);
    const mac = deps.mac();
    const view = evidence();
    const caps = view.capabilities;
    const act = (run: () => void) => {
      handledKeys.add(event);
      event.preventDefault();
      event.stopImmediatePropagation();
      run();
      return true;
    };
    if (matchesShortcut(event, 'mod+shift+s', mac))
      return caps.capture && !view.captureDisabled && !view.capturePending
        ? act(actions.onCapture)
        : false;
    if (matchesShortcut(event, 'mod+shift+r', mac))
      return caps.record || view.recording ? act(actions.onRecordToggle) : false;
    if (matchesShortcut(event, 'mod+shift+a', mac))
      return caps.annotate || view.annotating ? act(actions.onAnnotationToggle) : false;
    if (matchesShortcut(event, 'mod+shift+m', mac))
      return view.speech.available || view.speech.active ? act(actions.onDictationToggle) : false;
    // Tool keys belong to the annotate session only while not typing; M or 0 is mouse mode.
    if (view.annotating && !fieldFocused) {
      const plain = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
      const tool = TOOL_KEYS[event.key];
      if (tool && plain) return act(() => actions.onToolSelect(tool));
      if (plain && (event.key === '0' || event.key.toLowerCase() === 'm'))
        return act(() => dispatch(dockEvidenceMouseModeRequested(workspaceId, agentId)));
    }
    // Annotating: undo/redo the session's own marks (redoable), even from the focused
    // field (sessions never take focus). With nothing to undo or redo the key falls
    // through to text undo. Dictation alone keeps removing the newest mark.
    if (view.annotating && matchesShortcut(event, 'mod+shift+z', mac))
      return redoableDockMark(view.evidence ?? undefined)
        ? act(() => dispatch(dockEvidenceAnnotationRedoRequested(workspaceId, agentId)))
        : false;
    if (view.annotating && matchesShortcut(event, 'mod+z', mac))
      return undoableDockMark(view.evidence ?? undefined)
        ? act(() => dispatch(dockEvidenceAnnotationUndoRequested(workspaceId, agentId)))
        : false;
    if (view.speech.active && matchesShortcut(event, 'mod+z', mac) && view.evidence?.marks.length)
      return act(() => dispatch(dockEvidenceMarkUndone(workspaceId, agentId)));
    if (
      event.key === 'Escape' &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey
    ) {
      // One level per press: live capture first (kept), then the annotate session.
      if (view.speech.active) return act(() => void stopSpeech());
      if (view.recording) return act(actions.onRecordToggle);
      if (view.annotating)
        return act(() => dispatch(dockEvidenceAnnotationEndRequested(workspaceId, agentId)));
    }
    return false;
  }

  /** Typing into the field ends an annotate session (marks stay); dictation is unaffected. */
  function userTyped(): void {
    if (evidence().annotating) dispatch(dockEvidenceAnnotationEndRequested(workspaceId, agentId));
  }

  /** Marks follow their chips: a deleted chip removes its mark; an undone deletion restores it. */
  function referencesEdited(edit: DockReferenceEdit): void {
    dispatch(dockEvidenceReferencesEdited(workspaceId, agentId, edit));
    // Deleting a chip is typing (its Backspace never reaches beforeinput): end annotate.
    if (edit.removed.length) userTyped();
  }

  /** Keep timers live only while something is timed. */
  function syncTicker(view: EvidenceView): void {
    const timed = view.recording || !!view.dictation;
    if (timed && ticker === undefined && !disposed)
      ticker = setInterval(() => local.update((state) => ({ ...state, now: deps.now() })), 250);
    else if (!timed && ticker !== undefined) {
      clearInterval(ticker);
      ticker = undefined;
    }
  }

  return {
    scope,
    local: local as Readable<DockComposerLocalState>,
    dispose,
    beforeSubmit,
    insertionApplied,
    userTyped,
    referencesEdited,
    handleKey,
    refreshPreviews,
    syncTicker,
    actions,
    references: (view: EvidenceView, labels: DockComposerMediaLabels): EditorScreenReference[] =>
      screenReferences(view.evidence ?? undefined, labels.tools, labels.recordingReference),
  };
}

export type DockComposerController = ReturnType<typeof createDockComposerController>;
