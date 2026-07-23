import type { CommentManagerV2 } from '$features/comments/comment-manager-v2';
import type { TaskAgentAssociation } from '$store/renderer/slices/task-agent-associations/task-agent-associations-types';

import { reapplyCommentAnchorsAfterExternalUpdate } from './comment-manager-utils';
import { applyExternalUpdateHtmlToEditorPreservingCursor } from './external-update-editor';
import {
  shouldRejectExternalUpdateDueToUnsavedEdits,
  type ProcessHTMLToMarkdownLike,
} from './external-update-guard';
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
  // Protecting genuinely-unsaved edits is the job of
  // shouldRejectExternalUpdateDueToUnsavedEdits downstream in the pipeline.
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

export type ProcessMarkdownToHTMLLike = (
  markdown: string,
  opts: {
    preserveAnchors: boolean;
  },
) => Promise<string>;

export type ExternalUpdateEffectEditorLike = {
  isDestroyed?: boolean;
  getHTML: () => string;
  state: {
    selection?: { anchor?: number };
  };
  chain: () => {
    command: (fn: any) => any;
    setContent: (html: string) => any;
    run: () => void;
  };
};

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
}: {
  updateVersion: number;
  /** Check if component is destroyed - MUST be checked before any reactive state access in async callbacks */
  isDestroyed?: () => boolean;
  getEditor: () => ExternalUpdateEffectEditorLike | null | undefined;
  getIsInitialized: () => boolean;
  getIsUserTyping: () => boolean;
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

  return new Promise<void>((resolve) => {
    debounce.version = updateVersion;
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
    const freshContent = getCurrentNoteContent();
    const freshLastKnown = getLastKnownContent();
    if (freshContent === freshLastKnown) return;

    return processMarkdownToHTML(freshContent, { preserveAnchors: true }).then(
    async (newHtmlContent) => {
      // CRITICAL: Check destruction flag FIRST, before accessing ANY reactive state.
      // This prevents "N is not a function" errors when Svelte's reactive system
      // tries to call nullified internal functions after component destruction.
      // The promise callback may execute after the component has been destroyed.
      if (isDestroyed?.()) {
        return;
      }

      const editor = getEditor();
      if (!editor || editor.isDestroyed) return;

      // CRITICAL: Check if user has genuinely-unsaved edits before applying.
      // The guard combines the hasUserEditedSinceLastSave flag (fast path) with a
      // content comparison against lastKnownContent, because the flag alone
      // latches on the first local edit and cannot distinguish "unsaved edits"
      // from "saved edits + stale editor".
      //
      // Scenario: User types "A" → saves → types "B" → external update arrives with "A"
      // Editor ("AB") differs from both lastKnownContent and the incoming content,
      // so the update is rejected and the user's typing is preserved.
      //
      // Scenario: User types "A" → saves → agent appends server-side ("A + more")
      // Editor matches lastKnownContent ("A"), so the grown content is applied.
      if (
        shouldRejectExternalUpdateDueToUnsavedEdits({
          hasUserEditedSinceLastSave: getHasUserEditedSinceLastSave(),
          isUpdatingFromExternal: getIsUpdatingFromExternal(),
          editor,
          newContent: freshContent,
          lastKnownContent: getLastKnownContent(),
          processHTMLToMarkdown,
          noteId: getNoteId(),
          updateVersion,
          logger,
        })
      ) {
        return;
      }

      const currentEditorHtml = editor.getHTML();

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
          noteId: getNoteId(),
          updateVersion,
          newContentLength: freshContent?.length,
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
            editor,
            html: newHtmlContent,
            createTextSelection,
            logger,
          });

          setLastKnownContent(freshContent);

          if (didUpdate) {
            setHasUserEditedSinceLastSave(false);

            const workspaceId = getWorkspaceId();
            const noteId = getNoteId();
            if (workspaceId && noteId) {
              logger.debug(
                '[NoteWithComments] Restoring task-agent associations after external update',
                {
                  noteId,
                  updateVersion,
                },
              );
              restoreTaskAgentAssociations(editor as any, getTaskAgentAssociations?.() ?? [], logger);
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
        setLastKnownContent(freshContent);
        setHasUserEditedSinceLastSave(false);
      }
    },
    );
  });
}
