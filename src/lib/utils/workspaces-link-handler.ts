/**
 * Intent Link Handler
 *
 * Handles intent:// protocol links for internal navigation.
 * Formats:
 * - intent://local/note/{note-id} - Note in current workspace (backward compatible)
 * - intent://local/{workspace-id}/note/{note-id} - Note in specific workspace (cross-workspace)
 *
 * Currently org-id is a placeholder "local" since we don't have org concept yet.
 * This reserves the URL slot for future use.
 */

import { toast } from 'svelte-sonner';
import { selectCurrentWorkspace } from '$store/renderer/slices/workspace/workspace-selectors';
import { noteUrl } from '$shared/constants/intent-links';
import { store as appStore } from '$store/renderer/store';
import { m } from '$shared/paraglide/messages.js';

// URL-pattern examples shown in parse errors; passed as message params because
// literal `{`/`}` inside a Paraglide message would parse as a parameter.
// i18n-ignore (URL format placeholders)
const SHORT_FORMAT_EXAMPLE = 'intent://local/note/{note-id}';
// i18n-ignore (URL format placeholders)
const LONG_FORMAT_EXAMPLE = 'intent://local/{workspace-id}/note/{note-id}';

function invalidFormatError(): string {
  return m.ui_linkHandler_invalidFormat_error({
    shortFormat: SHORT_FORMAT_EXAMPLE,
    longFormat: LONG_FORMAT_EXAMPLE,
  });
}

export interface WorkspacesLinkInfo {
  type: 'note' | 'task' | 'unknown';
  orgId: string; // Reserved for future, currently "local"
  workspaceId?: string; // Target workspace ID (undefined = current workspace)
  resourceId: string; // noteId
  valid: boolean;
  error?: string;
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

/**
 * Parse an intent:// URL
 * Formats:
 * - intent://local/note/{note-id} - Note in current workspace
 * - intent://local/{workspace-id}/note/{note-id} - Note in specific workspace
 */
export function parseIntentLink(url: string): WorkspacesLinkInfo {
  try {
    // Remove protocol and parse
    // The URL format is: intent://org-id/[workspace-id/]note/note-id
    // When parsed as http://org-id/..., org-id becomes hostname
    const urlObj = new URL(url.replace('intent://', 'http://'));

    // Get org-id from hostname and path segments from pathname
    const orgId = urlObj.hostname;
    const pathSegments = urlObj.pathname
      .replace(/^\/+/, '')
      .split('/')
      .filter((s) => s.length > 0);

    // Need at least 2 segments: note/{note-id} or {workspace-id}/note/{note-id}
    if (!orgId || pathSegments.length < 2) {
      return {
        type: 'unknown',
        orgId: orgId || '',
        resourceId: '',
        valid: false,
        error: invalidFormatError(),
      };
    }

    // Determine format based on first segment
    // If first segment is 'note', it's the short format (current workspace)
    // Otherwise, first segment is workspace-id
    let workspaceId: string | undefined;
    let resourceType: string;
    let resourceId: string;

    if (pathSegments[0] === 'note' || pathSegments[0] === 'task') {
      // Short format: note/{note-id} or task/{note-id}
      resourceType = pathSegments[0];
      resourceId = pathSegments[1];
    } else if (
      pathSegments.length >= 3 &&
      (pathSegments[1] === 'note' || pathSegments[1] === 'task')
    ) {
      // Long format: {workspace-id}/note/{note-id} or {workspace-id}/task/{note-id}
      workspaceId = pathSegments[0];
      resourceType = pathSegments[1];
      resourceId = pathSegments[2];
    } else {
      return {
        type: 'unknown',
        orgId,
        resourceId: '',
        valid: false,
        error: invalidFormatError(),
      };
    }

    // Validate resource ID is not empty
    if (!resourceId || resourceId.trim().length === 0) {
      return {
        type: 'unknown',
        orgId,
        resourceId: '',
        valid: false,
        error: m.ui_linkHandler_emptyResourceId_error(),
      };
    }

    if (resourceType === 'note' || resourceType === 'task') {
      // Both 'note' and 'task' resolve to notes (task notes are just notes with task metadata)
      return {
        type: resourceType as 'note' | 'task',
        orgId,
        workspaceId,
        resourceId,
        valid: true,
      };
    }

    return {
      type: 'unknown',
      orgId,
      workspaceId,
      resourceId,
      valid: false,
      error: m.ui_linkHandler_unknownResourceType_error({ type: resourceType }),
    };
  } catch (error) {
    return {
      type: 'unknown',
      orgId: '',
      resourceId: '',
      valid: false,
      error: error instanceof Error ? error.message : m.ui_linkHandler_parseFailed_error(),
    };
  }
}

/**
 * Navigate to an intent:// URL
 * Returns true if handled, false if not an intent:// link
 */
export async function handleIntentLink(url: string): Promise<boolean> {
  if (!url.startsWith('intent://')) {
    return false;
  }

  const info = parseIntentLink(url);

  if (!info.valid) {
    toast.error(m.ui_linkHandler_invalidLink_title(), {
      description: info.error || m.ui_linkHandler_invalidLink_description(),
    });
    return true;
  }

  try {
    switch (info.type) {
      case 'note':
      case 'task':
        // Both note and task links navigate to notes (task notes are notes with task metadata)
        await navigateToNote(info);
        break;
      default:
        toast.error(m.ui_linkHandler_unsupportedLink_title(), {
          description: m.ui_linkHandler_unsupportedLink_description({ type: info.type }),
        });
    }
  } catch (error) {
    if (error instanceof NotFoundError) {
      toast.error(m.ui_linkHandler_notFound_title(), {
        description: error.message,
      });
    } else {
      toast.error(m.ui_linkHandler_navigationFailed_title(), {
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

// Backward compatibility aliases
/** @deprecated Use parseIntentLink instead */
export const parseWorkspacesLink = parseIntentLink;
/** @deprecated Use handleIntentLink instead */
export const handleWorkspacesLink = handleIntentLink;
/** @deprecated Use createIntentLinkClickHandler instead */
export const createWorkspacesLinkClickHandler = createIntentLinkClickHandler;

/**
 * Private: Navigate to a note
 */
async function navigateToNote(info: WorkspacesLinkInfo): Promise<void> {
  const { navigateToNote: navigateToNoteUtil } = await import('./workspace-navigation');
  const { navigateToRoute } = await import('./navigation.client');

  const currentWorkspace = selectCurrentWorkspace.select(appStore.state);

  // If the link includes a workspace ID, we can navigate even without a current workspace
  // (e.g., clicking a cross-workspace link from the home page)
  if (info.workspaceId) {
    const isCrossWorkspace = !currentWorkspace || info.workspaceId !== currentWorkspace.id;

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
      await navigateToNoteUtil(info.resourceId);
    }
    return;
  }

  // Short-form link (no workspace ID) - requires current workspace
  if (!currentWorkspace) {
    throw new NotFoundError(m.ui_linkHandler_noSpaceOpen_error());
  }

  // Check if note exists in current workspace
  const noteExists = await checkNoteExists(currentWorkspace.id, info.resourceId);
  if (!noteExists) {
    throw new NotFoundError(
      m.ui_linkHandler_noteNotFoundCurrent_error({ noteId: info.resourceId }),
    );
  }

  // Navigate to the note in current workspace
  await navigateToNoteUtil(info.resourceId);
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
