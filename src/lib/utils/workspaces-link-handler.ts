/**
 * Intent Link Handler
 *
 * Handles intent:// protocol links for internal navigation.
 * Formats:
 * - intent://local/note/{note-id} - Note in current workspace (backward compatible)
 * - intent://local/{workspace-id}/note/{note-id} - Note in specific workspace (cross-workspace)
 * - intent://local/file/{path} - Workspace-relative file in current workspace
 * - intent://local/{workspace-id}/file/{path} - File in specific workspace (cross-workspace)
 * - intent://local/{workspace-id}/agent/{agent-id}/message/{message-id} - Exact message
 *
 * Currently org-id is a placeholder "local" since we don't have org concept yet.
 * This reserves the URL slot for future use.
 */

import { notify } from '$lib/components/patterns/notify';
import { noteUrl } from '$shared/constants/intent-links';
import { store as appStore } from '$store/renderer/store';
import { m } from '$shared/paraglide/messages.js';
import {
  openWorkspaceFile,
  openWorkspaceNote,
} from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
import { selectCurrentWorkspaceTabId } from '$store/renderer/slices/tab-state/tab-state-selectors';
import { parseIntentLink, type WorkspacesLinkInfo } from '$shared/utils/intent-link-parser';

export { parseIntentLink, type WorkspacesLinkInfo };

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

/**
 * Navigate to an intent:// URL
 * Returns true if handled, false if not an intent:// link
 */
export interface IntentLinkNavigationOptions {
  workspaceId?: string;
  sourcePanelId?: string;
  openInAdjacentPanel?: boolean;
  openInNewAdjacentPanel?: boolean;
}

export async function handleIntentLink(
  url: string,
  options: IntentLinkNavigationOptions = {},
): Promise<boolean> {
  if (!url.startsWith('intent://')) {
    return false;
  }

  const info = parseIntentLink(url);

  if (!info.valid) {
    notify.error(m.ui_linkHandler_invalidLink_title(), {
      description: info.error || m.ui_linkHandler_invalidLink_description(),
    });
    return true;
  }

  try {
    switch (info.type) {
      case 'note':
      case 'task':
        // Both note and task links navigate to notes (task notes are notes with task metadata)
        await navigateToNote(info, options);
        break;
      case 'file':
        await navigateToFile(info, options);
        break;
      case 'message': {
        const { openMessage } = await import('./open-message');
        await openMessage({
          workspaceId: info.workspaceId!,
          agentId: info.agentId!,
          messageId: info.resourceId,
        });
        break;
      }
      default:
        notify.error(m.ui_linkHandler_unsupportedLink_title(), {
          description: m.ui_linkHandler_unsupportedLink_description({ type: info.type }),
        });
    }
  } catch (error) {
    if (error instanceof NotFoundError) {
      notify.error(m.ui_linkHandler_notFound_title(), {
        description: error.message,
      });
    } else {
      notify.error(m.ui_linkHandler_navigationFailed_title(), {
        description: error instanceof Error ? error.message : m.ui_linkHandler_unknownError_label(),
      });
    }
  }

  return true;
}

/**
 * Generate an intent:// URL for a note
 * Uses placeholder org-id "local" for now
 * @param noteId - The note ID
 * @param workspaceId - Optional workspace ID for cross-workspace links
 * @deprecated Use `noteUrl` from '$shared/constants/intent-links' directly instead
 */
export function generateNoteLink(noteId: string, workspaceId?: string): string {
  // Delegate to the shared constant to ensure consistency
  return noteUrl(noteId, workspaceId);
}

/**
 * Create a Tiptap click handler for intent:// links
 * Use this in editorProps.handleClick for both MarkdownViewer and editor-config
 */
export function createIntentLinkClickHandler() {
  return async (_view: any, _pos: number, event: MouseEvent) => {
    const target = event.target as HTMLElement;
    const anchor = target.closest('a');

    if (anchor?.href?.startsWith('intent://')) {
      event.preventDefault();
      return await handleIntentLink(anchor.href);
    }

    return false;
  };
}

/**
 * Private: Navigate to a note
 */
async function navigateToNote(
  info: WorkspacesLinkInfo,
  options: IntentLinkNavigationOptions,
): Promise<void> {
  const { navigateToRoute } = await import('./navigation.client');

  const sourceWorkspaceId =
    options.workspaceId ?? selectCurrentWorkspaceTabId.select(appStore.state) ?? undefined;

  // If the link includes a workspace ID, we can navigate even without a current workspace.
  if (info.workspaceId) {
    const isCrossWorkspace = !sourceWorkspaceId || info.workspaceId !== sourceWorkspaceId;

    // Check if note exists in target workspace
    const noteExists = await checkNoteExists(info.workspaceId, info.resourceId);
    if (!noteExists) {
      throw new NotFoundError(
        m.ui_linkHandler_noteNotFound_error({
          noteId: info.resourceId,
          workspaceId: info.workspaceId,
        }),
      );
    }

    if (isCrossWorkspace) {
      // Navigate to the target workspace and note
      // (navigateToRoute no-ops in the HUD pop-out window — never leaves /hud)
      await navigateToRoute(`/workspace/${info.workspaceId}?note=${info.resourceId}`);
    } else {
      // Same workspace - navigate to the note directly
      appStore.dispatch(
        openWorkspaceNote(info.workspaceId, info.resourceId, {
          openInAdjacentPanel: options.openInAdjacentPanel ?? false,
          openInNewAdjacentPanel: options.openInNewAdjacentPanel ?? false,
          sourcePanelId: options.sourcePanelId,
        }),
      );
    }
    return;
  }

  // Short-form link (no workspace ID) - requires current workspace
  if (!sourceWorkspaceId) {
    throw new NotFoundError(m.ui_linkHandler_noSpaceOpen_error());
  }

  // Check if note exists in current workspace
  const noteExists = await checkNoteExists(sourceWorkspaceId, info.resourceId);
  if (!noteExists) {
    throw new NotFoundError(
      m.ui_linkHandler_noteNotFoundCurrent_error({ noteId: info.resourceId }),
    );
  }

  // Navigate to the note in current workspace
  appStore.dispatch(
    openWorkspaceNote(sourceWorkspaceId, info.resourceId, {
      openInAdjacentPanel: options.openInAdjacentPanel ?? false,
      openInNewAdjacentPanel: options.openInNewAdjacentPanel ?? false,
      sourcePanelId: options.sourcePanelId,
    }),
  );
}

/**
 * Private: Navigate to a workspace file (opens the file viewer tab)
 */
async function navigateToFile(
  info: WorkspacesLinkInfo,
  options: IntentLinkNavigationOptions,
): Promise<void> {
  const sourceWorkspaceId =
    options.workspaceId ?? selectCurrentWorkspaceTabId.select(appStore.state) ?? undefined;

  // If the link includes a workspace ID, we can navigate even without a current workspace.
  if (info.workspaceId) {
    const isCrossWorkspace = !sourceWorkspaceId || info.workspaceId !== sourceWorkspaceId;

    if (isCrossWorkspace) {
      // Navigate to the target workspace first, then open the file there
      // (navigateToRoute no-ops in the HUD pop-out window — never leaves /hud)
      const { navigateToRoute } = await import('./navigation.client');
      await navigateToRoute(`/workspace/${info.workspaceId}`);
    }

    appStore.dispatch(
      openWorkspaceFile(info.workspaceId, info.resourceId, {
        filePathIsLiteral: true,
        ...(info.line !== undefined ? { line: info.line } : {}),
        openInAdjacentPanel: isCrossWorkspace ? false : (options.openInAdjacentPanel ?? false),
        sourcePanelId: isCrossWorkspace ? undefined : options.sourcePanelId,
      }),
    );
    return;
  }

  // Short-form link (no workspace ID) - requires current workspace
  if (!sourceWorkspaceId) {
    throw new NotFoundError(m.ui_linkHandler_noSpaceOpen_error());
  }

  appStore.dispatch(
    openWorkspaceFile(sourceWorkspaceId, info.resourceId, {
      filePathIsLiteral: true,
      ...(info.line !== undefined ? { line: info.line } : {}),
      openInAdjacentPanel: options.openInAdjacentPanel ?? false,
      sourcePanelId: options.sourcePanelId,
    }),
  );
}

/**
 * Check if a note exists in a workspace (daemon `note.get`, PROTOCOL §5.2)
 */
async function checkNoteExists(workspaceId: string, noteId: string): Promise<boolean> {
  try {
    const { backendRequest } = await import('$lib/client/live/backend-transport');
    const result = await backendRequest<{ note?: unknown } | unknown>('note.get', {
      workspaceId,
      noteId,
    });
    const note =
      result && typeof result === 'object' && 'note' in result
        ? (result as { note?: unknown }).note
        : result;
    return note != null && typeof note === 'object';
  } catch {
    return false;
  }
}
