import type { CommentManagerV2 } from '$features/comments/comment-manager-v2';
import { rebaseText } from '$lib/notes/text-rebase';
import type { TaskAgentAssociation } from '$store/renderer/slices/task-agent-associations/task-agent-associations-types';

import { reapplyCommentAnchorsAfterExternalUpdate } from './comment-manager-utils';
import {
  applyExternalUpdateHtmlToEditorPreservingCursor,
  createTextSelectionForDoc,
  type CreateTextSelectionLike,
  type ExternalUpdateDocLike,
} from './external-update-editor';
import type { LoggerLike } from './logger.types';
import { restoreTaskAgentAssociations } from './task-item-utils';

/**
 * Determines whether the safety-net effect should trigger an externalUpdateVersion
 * increment. This is extracted for testability — the actual $effect in the component
 * calls this and increments when it returns true.
 *
 * Returns `true` when Redux content diverges from lastKnownContent and all guards pass.
 */
export function shouldSafetyNetTrigger({
  reduxContent,
  lastKnownContent,
  lastSafetyNetSyncedContent,
  isInitialized,
}: {
  reduxContent: string | undefined;
  lastKnownContent: string;
  lastSafetyNetSyncedContent: string | undefined;
  isInitialized: boolean;
}): boolean {
  if (reduxContent === undefined) {
    return false;
  }
  // NOTE: neither hasUserEditedSinceLastSave nor isUserTyping gates the
  // safety-net. The edit flag latches on the first local edit and is only
  // cleared by a successful external apply, so gating on it permanently
  // disconnected open editors from server-side note growth (stale-editor
  // incident: comment.add sent unfindable context; debounced saves tripped the
  // daemon's content-reduction guard). Gating on typing let active typing hold
  // off the flush indefinitely. Unsaved edits are flushed and folded into the
  // applied text downstream in the pipeline instead. Nor does an apply in
  // progress gate it: the pipeline dedupes rapid updates itself (debounce +
  // per-note apply generation), and the former timer-cleared
  // "updating from external" flag left a wall-clock window in which a
  // divergence was never re-queued.
  if (!isInitialized) {
    return false;
  }
  // Dedupe: already synced this exact snapshot
  if (reduxContent === lastSafetyNetSyncedContent) {
    return false;
  }
  // Empty string is a valid content value — use strict inequality
  return reduxContent !== lastKnownContent;
}

/**
 * Decides whether the pipeline should be re-queued (externalUpdateVersion bump)
 * when the user-typing timeout clears. Historically external updates skipped
 * because `isUserTyping === true` were never re-queued — `isUserTyping` is a
 * plain non-reactive `let`, so nothing re-ran the pipeline once typing stopped
 * and the debounced save then clobbered the divergence out of Redux
 * (monorepo#534). The pipeline no longer skips while typing; this remains a
 * fallback for a divergence that slipped past the safety-net.
 */
export function shouldRequeueExternalUpdateAfterTypingStops({
  reduxContent,
  lastKnownContent,
}: {
  reduxContent: string | undefined;
  lastKnownContent: string;
}): boolean {
  if (reduxContent === undefined) return false;
  return reduxContent !== lastKnownContent;
}

/**
 * Decides whether the editor's onUpdate callback should ignore a local editor
 * update. Programmatic applies are filtered upstream by the `external-update`
 * transaction meta (editor-config's onUpdate never forwards them), so every
 * update reaching the callback is user input and the only suppression input is
 * initialization. A fixed post-apply reset tail used to suppress input here
 * too and dropped real keystrokes — neither `hasUserEditedSinceLastSave` nor a
 * save timer was set, so the next external apply overwrote and never persisted
 * them (monorepo#535).
 */
export function shouldIgnoreLocalEditorUpdate({
  isInitializing,
}: {
  isInitializing: boolean;
}): boolean {
  return isInitializing;
}

export type ProcessMarkdownToHTMLLike = (
  markdown: string,
  opts: {
    preserveAnchors: boolean;
    workspaceId?: string;
    workspaceFileVersion?: string;
  },
) => Promise<string>;

export type ProcessHTMLToMarkdownLike = (
  html: string,
  opts: {
    preserveAnchors: boolean;
  },
) => string;

export type FlushNoteContentLike = (
  workspaceId: string,
  noteId: string,
) => Promise<{ content: string; rev?: number } | undefined>;

export type ExternalUpdateEffectEditorLike = {
  isDestroyed?: boolean;
  getHTML: () => string;
  state: {
    doc?: ExternalUpdateDocLike;
    selection?: { anchor?: number; head?: number };
  };
  chain: () => {
    command: (fn: any) => any;
    setContent: (html: string) => any;
    run: () => void;
  };
};

/**
 * The text to put in the editor for an incoming external `incoming`: when the
 * editor still holds keystrokes that never reached a save (`ours` differs from
 * the last saved/applied `base`), they are replayed onto `incoming` so the
 * apply neither drops them nor lets the next save delete the external change.
 */
export function foldUnsavedEditsIntoIncoming({
  base,
  incoming,
  ours,
}: {
  base: string;
  incoming: string;
  ours: string;
}): string {
  if (ours === base || ours === incoming) return incoming;
  return rebaseText(base, incoming, ours);
}

// --- Debounce state for rapid external updates (e.g. agent editing) ---
// When the agent streams edits, many content updates arrive in quick succession.
// We debounce so only the *last* update in a burst triggers the expensive
// processMarkdownToHTML → editor.setContent pipeline.
//
// State is keyed per-note so that multiple open NoteWithComments instances
// (e.g. split panels) don't interfere with each other's debounce timers.
const EXTERNAL_UPDATE_DEBOUNCE_MS = 150;

interface DebounceState {
  timer: ReturnType<typeof setTimeout> | null;
  version: number;
}
const debounceByNote = new Map<string, DebounceState>();

// Per-note state below is keyed by workspace AND note: note ids repeat across
// workspaces (every workspace has a `spec`), so two editors showing same-id
// notes in different workspaces must never share a debounce, recheck or apply
// generation — an apply in one would mark the other's pending render stale.
function noteStateKey(workspaceId: string | undefined, noteId: string | null | undefined): string {
  return `${workspaceId ?? '__no_workspace__'}:${noteId ?? '__no_note__'}`;
}

// --- Deferred-recheck state for an in-flight save (monorepo#533) ---
// When the editor is dirty but nothing is debounced (the save is already in
// flight, or the flush failed), the apply waits for that save to settle.
// Relying solely on the daemon's note:updated refetch to re-queue is a
// potential dead end: if the resolved save leaves the Redux snapshot unchanged
// (e.g. a conflict reload matching an already-refetched value), no reactive
// dep changes and the safety-net dedupe blocks a re-fire. This poll re-queues
// the pipeline exactly once when the pending window closes.
const PENDING_SAVE_RECHECK_INTERVAL_MS = 250;
const pendingSaveRecheckByNote = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleDeferredRecheckWhenSaveSettles(
  key: string,
  getHasPendingNoteContent: () => boolean,
  onPendingSaveSettled: (() => void) | undefined,
  isDestroyed: (() => boolean) | undefined,
): void {
  if (!onPendingSaveSettled) return;
  if (pendingSaveRecheckByNote.has(key)) return;
  const poll = () => {
    pendingSaveRecheckByNote.delete(key);
    if (isDestroyed?.()) return;
    if (getHasPendingNoteContent()) {
      pendingSaveRecheckByNote.set(key, setTimeout(poll, PENDING_SAVE_RECHECK_INTERVAL_MS));
      return;
    }
    onPendingSaveSettled();
  };
  pendingSaveRecheckByNote.set(key, setTimeout(poll, PENDING_SAVE_RECHECK_INTERVAL_MS));
}

function getDebounceState(key: string): DebounceState {
  let state = debounceByNote.get(key);
  if (!state) {
    state = { timer: null, version: -1 };
    debounceByNote.set(key, state);
  }
  return state;
}

// --- Apply generation per note (stale-render guard) ---
// Each apply renders its markdown asynchronously. When a newer apply for the
// same note starts before an older render resolves, the older result must be
// dropped at apply time — the initial debounce cannot see it, and applying it
// would regress the editor to the older text.
const applyGenerationByNote = new Map<string, number>();

function beginApplyGeneration(key: string): number {
  const generation = (applyGenerationByNote.get(key) ?? 0) + 1;
  applyGenerationByNote.set(key, generation);
  return generation;
}

function isCurrentApplyGeneration(key: string, generation: number): boolean {
  return applyGenerationByNote.get(key) === generation;
}

export function runExternalContentUpdateEffect({
  updateVersion,
  isDestroyed,
  getEditor,
  getIsInitialized,
  getHasPendingNoteContent,
  stageUnsavedEdits,
  flushNoteContent,
  onPendingSaveSettled,
  getCurrentNoteContent,
  getCurrentNoteRev,
  getLastKnownContent,
  setLastKnownContent,
  getHasUserEditedSinceLastSave,
  setHasUserEditedSinceLastSave,
  getIsRestorePending,
  setIsRestorePending,
  getWorkspaceId,
  getNoteId,
  getOwnerToken,
  getTaskAgentAssociations,
  getCommentManager,
  processMarkdownToHTML,
  processHTMLToMarkdown,
  createTextSelection = createTextSelectionForDoc,
  logger,
  workspaceFileVersion,
}: {
  updateVersion: number;
  /** Check if component is destroyed - MUST be checked before any reactive state access in async callbacks */
  isDestroyed?: () => boolean;
  getEditor: () => ExternalUpdateEffectEditorLike | null | undefined;
  getIsInitialized: () => boolean;
  /**
   * Whether the write-service still holds an unacknowledged content save for
   * this note (debounced or in flight). While true, Redux may hold refetched
   * content that predates the save, so applying it would visibly revert the
   * editor — and typing on the reverted doc before the flush would silently
   * drop the earlier edit (monorepo#533). The pending save is flushed
   * synchronously instead and the daemon's merged result is applied.
   */
  getHasPendingNoteContent?: () => boolean;
  /**
   * Hand the editor's current content to the write-service now, bypassing the
   * component's save debounce, so keystrokes still waiting on that debounce
   * are part of the flush below instead of holding it off until typing stops.
   * Called only while the editor holds unsaved edits and no whole-document
   * replacement is in progress.
   */
  stageUnsavedEdits?: () => void;
  /**
   * Flush the note's debounced content save now and resolve with the daemon's
   * merged result (`undefined` when nothing was debounced or the save failed).
   */
  flushNoteContent?: FlushNoteContentLike;
  /**
   * Called (once) when a flush resolved without a result and the in-flight
   * save's window closes, so the caller can re-queue the pipeline (bump
   * externalUpdateVersion). Needed because the daemon refetch may leave the
   * Redux snapshot unchanged — no reactive dep changes and the safety-net
   * dedupe would block a re-fire (dead end).
   */
  onPendingSaveSettled?: () => void;
  getCurrentNoteContent: () => string;
  /** Rev of the store content `getCurrentNoteContent` returns, read together with it. */
  getCurrentNoteRev?: () => number | undefined;
  getLastKnownContent: () => string;
  /**
   * Record the text the editor now derives from and, when known, the daemon
   * rev that text is — the base the next save's `expectedVersion` must name.
   */
  setLastKnownContent: (value: string, rev?: number) => void;
  getHasUserEditedSinceLastSave: () => boolean;
  setHasUserEditedSinceLastSave: (value: boolean) => void;
  /**
   * Whether a `note.restoreVersion` the user requested is still awaiting its
   * content. The next apply is then a whole-document replacement: unsaved
   * edits are neither staged nor folded, and the flag is cleared by that
   * apply (not by a timer). User input is identified per transaction — the
   * apply's own transactions carry the `external-update` meta and never reach
   * the component's onUpdate, every unmarked transaction does — so outside a
   * pending restore there is no window in which a keystroke is ignored.
   */
  getIsRestorePending?: () => boolean;
  setIsRestorePending?: (value: boolean) => void;
  getWorkspaceId: () => string | undefined;
  getNoteId: () => string | null | undefined;
  /**
   * Identity of the note the editor currently shows (the component's
   * note-conversion generation). Captured at entry together with the
   * workspace/note ids and rechecked after every await: a flush or render
   * that resolves once the editor shows another note — or the same note
   * re-initialized — must neither touch that editor nor its baseline.
   */
  getOwnerToken?: () => unknown;
  getTaskAgentAssociations?: () => TaskAgentAssociation[];
  getCommentManager: () => CommentManagerV2 | null | undefined;
  processMarkdownToHTML: ProcessMarkdownToHTMLLike;
  processHTMLToMarkdown: ProcessHTMLToMarkdownLike;
  /** Test seam; production uses the bound `createTextSelectionForDoc`. */
  createTextSelection?: CreateTextSelectionLike;
  logger: LoggerLike;
  /**
   * The editor instance's cache-busting token for `workspace-file://` images,
   * so every debounced external re-process keeps identical image URLs instead
   * of re-fetching each image from the daemon per update.
   */
  workspaceFileVersion?: string;
}): Promise<void> | void {
  // CRITICAL: Check destruction flag FIRST, before accessing ANY reactive state.
  // This prevents "N is not a function" errors when Svelte's reactive system
  // tries to call nullified internal functions during async callback execution
  // after component destruction.
  if (isDestroyed?.()) {
    return;
  }

  const editor = getEditor();
  const isInitialized = getIsInitialized();
  const noteId = getNoteId();

  // NOTE: an apply already in progress is not a reason to skip. When multiple
  // external updates arrive rapidly (e.g., when an agent delegates multiple
  // tasks), we need to process them all; the debounce and the per-note apply
  // generation below take care of superseded updates. Nor is active typing a
  // reason to skip: a dirty editor is flushed now and keystrokes are folded
  // into the applied text.
  if (!editor || !isInitialized) {
    logger.info('[NoteWithComments] Skipping external effect', {
      hasEditor: !!editor,
      isInitialized,
      updateVersion,
      noteId,
    });
    return;
  }

  const newContent = getCurrentNoteContent();
  const lastKnownContent = getLastKnownContent();

  logger.info('[NoteWithComments] External effect processing', {
    updateVersion,
    noteId,
    newContentLength: newContent?.length,
    lastKnownContentLength: lastKnownContent?.length,
    contentChanged: newContent !== lastKnownContent,
  });

  if (newContent === lastKnownContent) {
    logger.debug('[NoteWithComments] External effect no-op - content matches lastKnownContent', {
      noteId,
      updateVersion,
      length: newContent?.length ?? 0,
    });
    return;
  }

  logger.debug('[NoteWithComments] External content effect triggered', {
    noteId,
    updateVersion,
    newContentLength: newContent?.length,
    lastKnownLength: lastKnownContent?.length,
    contentChanged: newContent !== lastKnownContent,
  });

  const workspaceId = getWorkspaceId();
  const ownerToken = getOwnerToken?.();
  const stateKey = noteStateKey(workspaceId, noteId);

  // Whether the editor has moved on to another note (or the same note was
  // re-initialized) since this effect started. The live getEditor /
  // getLastKnownContent bindings then belong to that other note, and the
  // apply generation below is keyed by the note this effect started for, so
  // it cannot invalidate a continuation held across the switch.
  const ownerChanged = (): boolean =>
    getNoteId() !== noteId || getWorkspaceId() !== workspaceId || getOwnerToken?.() !== ownerToken;

  const dropIfOwnerChanged = (stage: string): boolean => {
    if (!ownerChanged()) return false;
    logger.info('[NoteWithComments] Dropping external apply - editor changed note owner', {
      noteId,
      currentNoteId: getNoteId(),
      updateVersion,
      stage,
    });
    return true;
  };

  // Keystrokes that never reached a save are replayed onto the text about to
  // be applied; a whole-document replacement the user requested
  // (note.restoreVersion) is applied verbatim.
  const isRestorePending = () => getIsRestorePending?.() ?? false;
  const canFoldUnsavedEdits = () => getHasUserEditedSinceLastSave() && !isRestorePending();

  // A dirty editor whose text cannot be serialized cannot have its keystrokes
  // folded into the incoming text, and applying that text verbatim would erase
  // them: the apply is abandoned instead (fail closed), leaving the document,
  // baseline and dirty flag untouched for the next update or save to settle.
  const readEditorMarkdown = (
    source: ExternalUpdateEffectEditorLike,
    stage: string,
  ): string | undefined => {
    try {
      return processHTMLToMarkdown(source.getHTML(), { preserveAnchors: true });
    } catch (error) {
      logger.error('[NoteWithComments] Failed to normalize current editor content', error);
      logger.warn(
        // i18n-ignore (log line)
        '[NoteWithComments] Dropping external apply - dirty editor could not be serialized',
        { noteId, updateVersion, stage },
      );
      return undefined;
    }
  };

  const applyIncomingContent = async (incoming: string, incomingRev?: number): Promise<void> => {
    const editor = getEditor();
    if (!editor || editor.isDestroyed) return;

    const generation = beginApplyGeneration(stateKey);
    const replacesWholeDocument = isRestorePending();

    // `ours` is the editor text `target` accounts for: the saved/applied
    // baseline until unsaved keystrokes are folded in. Applying the incoming
    // text verbatim over them would drop them, and the next save would then
    // carry a text without the external change and delete it on the daemon.
    let ours = getLastKnownContent();
    let target = incoming;
    if (!replacesWholeDocument && canFoldUnsavedEdits()) {
      const current = readEditorMarkdown(editor, 'fold');
      if (current === undefined) return;
      target = foldUnsavedEditsIntoIncoming({ base: ours, incoming, ours: current });
      ours = current;
    }

    // Render `target`, then re-read the editor: a keystroke that landed while
    // the markdown was converting is folded onto the rendered text and the
    // render repeated, since applying the now-stale HTML would overwrite it.
    const renderLatest = async (): Promise<
      { html: string; editor: ExternalUpdateEffectEditorLike } | undefined
    > => {
      for (;;) {
        const html = await processMarkdownToHTML(target, {
          preserveAnchors: true,
          workspaceId,
          workspaceFileVersion,
        });

        // CRITICAL: Check destruction flag FIRST, before accessing ANY reactive state.
        // This prevents "N is not a function" errors when Svelte's reactive system
        // tries to call nullified internal functions after component destruction.
        // The promise callback may execute after the component has been destroyed.
        if (isDestroyed?.()) return undefined;
        if (dropIfOwnerChanged('render')) return undefined;

        if (!isCurrentApplyGeneration(stateKey, generation)) {
          logger.info('[NoteWithComments] Dropping stale external apply', {
            noteId,
            updateVersion,
          });
          return undefined;
        }

        const liveEditor = getEditor();
        if (!liveEditor || liveEditor.isDestroyed) return undefined;

        if (replacesWholeDocument || !canFoldUnsavedEdits()) return { html, editor: liveEditor };
        const typed = readEditorMarkdown(liveEditor, 'render');
        if (typed === undefined) return undefined;
        if (typed === ours) return { html, editor: liveEditor };
        target = foldUnsavedEditsIntoIncoming({ base: ours, incoming: target, ours: typed });
        ours = typed;
      }
    };

    const rendered = await renderLatest();
    if (!rendered) return;
    const { html: newHtmlContent, editor: liveEditor } = rendered;

    const folded = target !== incoming;
    if (folded) {
      logger.info('[NoteWithComments] Folding unsaved edits into external update', {
        noteId,
        updateVersion,
      });
    }

    const currentEditorHtml = liveEditor.getHTML();

    // For comparison, strip out anchor spans from both HTML strings
    // This allows us to detect actual content changes vs just anchor differences
    const stripAnchors = (html: string) =>
      html.replace(/<span[^>]*data-anchor-id[^>]*><\/span>/g, '');

    const currentWithoutAnchors = stripAnchors(currentEditorHtml);
    const newWithoutAnchors = stripAnchors(newHtmlContent);

    if (currentWithoutAnchors !== newWithoutAnchors) {
      const hasAnchors = currentEditorHtml.includes('data-anchor-id');
      const anchorCount = hasAnchors
        ? (currentEditorHtml.match(/data-anchor-id/g) || []).length
        : 0;

      logger.debug('[NoteWithComments] External content change detected', {
        noteId,
        updateVersion,
        newContentLength: incoming?.length,
        hasAnchors,
        anchorCount,
        strategy: hasAnchors ? 'reapply-anchors' : 'direct-update',
      });

      // The apply's transactions carry the `external-update` meta, which is
      // what keeps them out of the component's onUpdate; no flag is raised
      // around the apply, so a keystroke landing right after it is user input
      // like any other.
      const didUpdate = applyExternalUpdateHtmlToEditorPreservingCursor({
        editor: liveEditor,
        html: newHtmlContent,
        mapSelectionThroughDiff: true,
        createTextSelection,
        logger,
      });

      // Folded keystrokes stay unsaved relative to the incoming text; their
      // already-scheduled save carries them against the incoming rev.
      setLastKnownContent(incoming, incomingRev);
      if (replacesWholeDocument) setIsRestorePending?.(false);

      if (didUpdate) {
        setHasUserEditedSinceLastSave(folded);

        if (workspaceId && noteId) {
          logger.debug(
            // i18n-ignore (log line)
            '[NoteWithComments] Restoring task-agent associations after external update',
            {
              noteId,
              updateVersion,
            },
          );
          restoreTaskAgentAssociations(
            liveEditor as any,
            getTaskAgentAssociations?.() ?? [],
            logger,
          );
        }

        await reapplyCommentAnchorsAfterExternalUpdate({
          hasAnchors,
          commentManager: getCommentManager(),
          noteId: noteId ?? undefined,
          updateVersion,
          anchorCount,
          logger,
        });
      }
    } else {
      // Content is the same (ignoring anchors), just update tracking
      setLastKnownContent(incoming, incomingRev);
      if (replacesWholeDocument) setIsRestorePending?.(false);
      setHasUserEditedSinceLastSave(folded);
    }
  };

  // Dirty editor: flush the pending save now (no debounce wait) and apply the
  // daemon's merged result. Without a flush binding, or when nothing was
  // debounced (the save is already in flight) or the save failed, wait for the
  // in-flight save to settle: the daemon's `note:updated` refetch usually
  // re-queues the pipeline via the safety-net, and the scheduled recheck
  // covers the case where the resolved save leaves Redux unchanged.
  const flushDirtyEditorAndApply = (): Promise<void> | undefined => {
    const getHasPending = getHasPendingNoteContent ?? (() => false);
    if (!flushNoteContent || !workspaceId || !noteId) {
      logger.info('[NoteWithComments] Deferring external effect - pending local save unflushed', {
        updateVersion,
        noteId,
      });
      scheduleDeferredRecheckWhenSaveSettles(
        stateKey,
        getHasPending,
        onPendingSaveSettled,
        isDestroyed,
      );
      return undefined;
    }
    logger.info('[NoteWithComments] Flushing pending local save before external apply', {
      updateVersion,
      noteId,
    });
    return flushNoteContent(workspaceId, noteId).then((applied) => {
      if (isDestroyed?.()) return;
      if (dropIfOwnerChanged('flush')) return;
      if (!applied) {
        logger.info(
          // i18n-ignore (log line)
          '[NoteWithComments] Flush returned no content - waiting for the in-flight save',
          { updateVersion, noteId },
        );
        scheduleDeferredRecheckWhenSaveSettles(
          stateKey,
          getHasPending,
          onPendingSaveSettled,
          isDestroyed,
        );
        return;
      }
      return applyIncomingContent(applied.content, applied.rev);
    });
  };

  // Whether a content save must be flushed before applying. Keystrokes still
  // waiting on the component's save debounce are staged into the
  // write-service first so they ride the flush: "flush while dirty" means now,
  // not once typing stops.
  const hasPendingSaveAfterStaging = (): boolean => {
    if (stageUnsavedEdits && canFoldUnsavedEdits()) stageUnsavedEdits();
    return getHasPendingNoteContent?.() ?? false;
  };

  // --- Debounce rapid updates ---
  // When an agent is streaming edits, dozens of updates arrive per second.
  // Debounce so we only run the expensive markdown→HTML pipeline for the
  // *last* update in a burst, avoiding redundant worker calls and
  // editor.setContent thrashing.
  const debounce = getDebounceState(stateKey);
  if (debounce.timer !== null) {
    clearTimeout(debounce.timer);
    debounce.timer = null;
    logger.debug('[NoteWithComments] Debounced superseded external update', {
      noteId,
      supersededVersion: debounce.version,
      newVersion: updateVersion,
    });
  }
  debounce.version = updateVersion;

  if (hasPendingSaveAfterStaging()) {
    return flushDirtyEditorAndApply();
  }

  return new Promise<void>((resolve) => {
    debounce.timer = setTimeout(() => {
      debounce.timer = null;
      resolve();
    }, EXTERNAL_UPDATE_DEBOUNCE_MS);
  }).then(() => {
    // After debounce, re-check freshness: if another update superseded us, bail out.
    if (debounce.version !== updateVersion) {
      return;
    }
    // Also re-check destruction / owner / content in case things changed during the debounce window.
    if (isDestroyed?.()) return;
    if (dropIfOwnerChanged('debounce')) return;
    // Re-check the pending-save window: a keystroke during the debounce may
    // have scheduled a new save — flush it and apply the merged result.
    if (hasPendingSaveAfterStaging()) {
      return flushDirtyEditorAndApply();
    }
    const freshContent = getCurrentNoteContent();
    const freshRev = getCurrentNoteRev?.();
    const freshLastKnown = getLastKnownContent();
    if (freshContent === freshLastKnown) return;

    return applyIncomingContent(freshContent, freshRev);
  });
}
