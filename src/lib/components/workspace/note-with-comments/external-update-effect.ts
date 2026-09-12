import type { CommentManagerV2 } from '$features/comments/comment-manager-v2';
import { rebaseText } from '$lib/notes/text-rebase';
import type { TaskAgentAssociation } from '$store/renderer/slices/task-agent-associations/task-agent-associations-types';

import { reapplyCommentAnchorsAfterExternalUpdate } from './comment-manager-utils';
import {
  applyExternalUpdateHtmlToEditorPreservingCursor,
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
  isUserTyping,
  isUpdatingFromExternal,
}: {
  reduxContent: string | undefined;
  lastKnownContent: string;
  lastSafetyNetSyncedContent: string | undefined;
  isInitialized: boolean;
  isUserTyping: boolean;
  isUpdatingFromExternal: boolean;
}): boolean {
  if (reduxContent === undefined) {
    return false;
  }
  // NOTE: hasUserEditedSinceLastSave intentionally does NOT gate the safety-net.
  // The flag latches on the first local edit and is only cleared by a successful
  // external apply, so gating on it permanently disconnected open editors from
  // server-side note growth (stale-editor incident: comment.add sent unfindable
  // context; debounced saves tripped the daemon's content-reduction guard).
  // Unsaved edits are flushed and folded into the applied text downstream in
  // the pipeline instead.
  if (!isInitialized || isUserTyping) {
    return false;
  }
  if (isUpdatingFromExternal) {
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
 * when the user-typing timeout clears. External updates skipped because
 * `isUserTyping === true` were never re-queued — `isUserTyping` is a plain
 * non-reactive `let`, so nothing re-ran the pipeline once typing stopped and
 * the debounced save then clobbered the divergence out of Redux (monorepo#534).
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
 * transaction meta (editor-config's onUpdate never forwards them), so this
 * intentionally does NOT gate on `isUpdatingFromExternal`: suppressing all
 * input for the fixed 200ms post-apply reset tail dropped real keystrokes —
 * neither `hasUserEditedSinceLastSave` nor a save timer was set, so the next
 * external apply overwrote and never persisted them (monorepo#535).
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
  noteId: string | null | undefined,
  getHasPendingNoteContent: () => boolean,
  onPendingSaveSettled: (() => void) | undefined,
  isDestroyed: (() => boolean) | undefined,
): void {
  if (!onPendingSaveSettled) return;
  const key = noteId ?? '__no_note__';
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

function getDebounceState(noteId: string | null | undefined): DebounceState {
  const key = noteId ?? '__no_note__';
  let state = debounceByNote.get(key);
  if (!state) {
    state = { timer: null, version: -1 };
    debounceByNote.set(key, state);
  }
  return state;
}

export function runExternalContentUpdateEffect({
  updateVersion,
  isDestroyed,
  getEditor,
  getIsInitialized,
  getIsUserTyping,
  getHasPendingNoteContent,
  flushNoteContent,
  onPendingSaveSettled,
  getCurrentNoteContent,
  getLastKnownContent,
  setLastKnownContent,
  getHasUserEditedSinceLastSave,
  setHasUserEditedSinceLastSave,
  getIsUpdatingFromExternal,
  setIsUpdatingFromExternal,
  getWorkspaceId,
  getNoteId,
  getTaskAgentAssociations,
  getCommentManager,
  processMarkdownToHTML,
  processHTMLToMarkdown,
  createTextSelection,
  logger,
  workspaceFileVersion,
}: {
  updateVersion: number;
  /** Check if component is destroyed - MUST be checked before any reactive state access in async callbacks */
  isDestroyed?: () => boolean;
  getEditor: () => ExternalUpdateEffectEditorLike | null | undefined;
  getIsInitialized: () => boolean;
  getIsUserTyping: () => boolean;
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
  getLastKnownContent: () => string;
  setLastKnownContent: (value: string) => void;
  getHasUserEditedSinceLastSave: () => boolean;
  setHasUserEditedSinceLastSave: (value: boolean) => void;
  getIsUpdatingFromExternal: () => boolean;
  setIsUpdatingFromExternal: (value: boolean) => void;
  getWorkspaceId: () => string | undefined;
  getNoteId: () => string | null | undefined;
  getTaskAgentAssociations?: () => TaskAgentAssociation[];
  getCommentManager: () => CommentManagerV2 | null | undefined;
  processMarkdownToHTML: ProcessMarkdownToHTMLLike;
  processHTMLToMarkdown: ProcessHTMLToMarkdownLike;
  createTextSelection: (doc: any, anchor: number, head?: number) => any;
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
  const isUserTyping = getIsUserTyping();
  const noteId = getNoteId();

  // NOTE: We intentionally do NOT check isUpdatingFromExternal here.
  // That flag is used to tell the editor's onUpdate handler to ignore
  // programmatic changes. But when multiple external updates arrive rapidly
  // (e.g., when an agent delegates multiple tasks), we need to process them all.
  // The flag would block subsequent updates while the first one is being applied.
  if (!editor || !isInitialized || isUserTyping) {
    logger.info('[NoteWithComments] Skipping external effect', {
      hasEditor: !!editor,
      isInitialized,
      isUserTyping,
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

  const applyIncomingContent = async (incoming: string): Promise<void> => {
    const editor = getEditor();
    if (!editor || editor.isDestroyed) return;

    // Keystrokes that never reached a save (the editor moved past
    // lastKnownContent) are replayed onto the incoming text: applying it
    // verbatim would drop them, and the next save would then carry a text
    // without the external change and delete it on the daemon. A whole-document
    // replacement in progress (note.restoreVersion) is applied verbatim.
    let target = incoming;
    if (getHasUserEditedSinceLastSave() && !getIsUpdatingFromExternal()) {
      try {
        const ours = processHTMLToMarkdown(editor.getHTML(), { preserveAnchors: true });
        target = foldUnsavedEditsIntoIncoming({ base: getLastKnownContent(), incoming, ours });
      } catch (error) {
        logger.error('[NoteWithComments] Failed to normalize current editor content', error);
      }
    }
    const folded = target !== incoming;
    if (folded) {
      logger.info('[NoteWithComments] Folding unsaved edits into external update', {
        noteId,
        updateVersion,
      });
    }

    const newHtmlContent = await processMarkdownToHTML(target, {
      preserveAnchors: true,
      workspaceId,
      workspaceFileVersion,
    });

    // CRITICAL: Check destruction flag FIRST, before accessing ANY reactive state.
    // This prevents "N is not a function" errors when Svelte's reactive system
    // tries to call nullified internal functions after component destruction.
    // The promise callback may execute after the component has been destroyed.
    if (isDestroyed?.()) {
      return;
    }

    const liveEditor = getEditor();
    if (!liveEditor || liveEditor.isDestroyed) return;

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

      setIsUpdatingFromExternal(true);

      const resetExternalUpdateFlag = () => {
        setTimeout(() => {
          setIsUpdatingFromExternal(false);
        }, 200);
      };

      try {
        const didUpdate = applyExternalUpdateHtmlToEditorPreservingCursor({
          editor: liveEditor,
          html: newHtmlContent,
          mapSelectionThroughDiff: true,
          createTextSelection,
          logger,
        });

        // Folded keystrokes stay unsaved relative to the incoming text; their
        // already-scheduled save carries them against the incoming rev.
        setLastKnownContent(incoming);

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
      } finally {
        resetExternalUpdateFlag();
      }
    } else {
      // Content is the same (ignoring anchors), just update tracking
      setLastKnownContent(incoming);
      setHasUserEditedSinceLastSave(folded);
    }
  };

  // Dirty editor: flush the pending save now (no debounce wait) and apply the
  // daemon's merged result. Without a flush binding, or when nothing was
  // debounced (the save is already in flight) or the save failed, wait for the
  // in-flight save to settle: the daemon's `note:updated` refetch usually
  // re-queues the pipeline via the safety-net, and the scheduled recheck
  // covers the case where the resolved save leaves Redux unchanged.
  const flushDirtyEditorAndApply = (getHasPending: () => boolean): Promise<void> | undefined => {
    if (!flushNoteContent || !workspaceId || !noteId) {
      logger.info('[NoteWithComments] Deferring external effect - pending local save unflushed', {
        updateVersion,
        noteId,
      });
      scheduleDeferredRecheckWhenSaveSettles(
        noteId,
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
      if (!applied) {
        logger.info(
          // i18n-ignore (log line)
          '[NoteWithComments] Flush returned no content - waiting for the in-flight save',
          { updateVersion, noteId },
        );
        scheduleDeferredRecheckWhenSaveSettles(
          noteId,
          getHasPending,
          onPendingSaveSettled,
          isDestroyed,
        );
        return;
      }
      return applyIncomingContent(applied.content);
    });
  };

  // --- Debounce rapid updates ---
  // When an agent is streaming edits, dozens of updates arrive per second.
  // Debounce so we only run the expensive markdown→HTML pipeline for the
  // *last* update in a burst, avoiding redundant worker calls and
  // editor.setContent thrashing.
  const debounce = getDebounceState(noteId);
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

  if (getHasPendingNoteContent?.()) {
    return flushDirtyEditorAndApply(getHasPendingNoteContent);
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
    // Also re-check destruction / content in case things changed during the debounce window.
    if (isDestroyed?.()) return;
    // Re-check the pending-save window: a keystroke during the debounce may
    // have scheduled a new save — flush it and apply the merged result.
    if (getHasPendingNoteContent?.()) {
      return flushDirtyEditorAndApply(getHasPendingNoteContent);
    }
    const freshContent = getCurrentNoteContent();
    const freshLastKnown = getLastKnownContent();
    if (freshContent === freshLastKnown) return;

    return applyIncomingContent(freshContent);
  });
}
