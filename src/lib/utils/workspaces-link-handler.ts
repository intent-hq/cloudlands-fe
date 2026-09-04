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

import { toast } from 'svelte-sonner';
import { noteUrl } from '$shared/constants/intent-links';
import { store as appStore } from '$store/renderer/store';
import { m } from '$shared/paraglide/messages.js';
import {
  openWorkspaceFile,
  openWorkspaceNote,
} from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
import { selectCurrentWorkspaceTabId } from '$store/renderer/slices/tab-state/tab-state-selectors';
import { parseFilePathLineSuffix } from '$shared/utils/link-helpers';

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
  type: 'note' | 'task' | 'file' | 'message' | 'unknown';
  orgId: string; // Reserved for future, currently "local"
  workspaceId?: string; // Target workspace ID (undefined = current workspace)
  resourceId: string; // noteId, messageId, or decoded workspace-relative file path
  line?: number; // Starting line for file links
  agentId?: string; // Conversation owner for message links
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
 * - intent://local/file/{path} - Workspace-relative file in current workspace
 * - intent://local/{workspace-id}/file/{path} - File in specific workspace
 * - intent://local/{workspace-id}/agent/{agent-id}/message/{message-id} - Exact message
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

    // Raw (un-normalized) path segments after the org-id. The URL parser
    // resolves "." / ".." dot segments, which would silently rewrite
    // traversal-looking file paths instead of rejecting them — so file links
    // parse from the raw path. Empty segments are preserved so doubled or
    // leading slashes (e.g. file//etc/passwd) fail path validation instead
    // of being silently collapsed.
    const rawSegments = url.replace('intent://', '').split(/[?#]/)[0].split('/').slice(1);

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
    let agentId: string | undefined;
    let line: number | undefined;

    if (rawSegments[0] === 'file') {
      // Short format: file/{workspace-relative-path} (remaining segments form the path)
      resourceType = 'file';
      resourceId = decodeFilePathSegments(rawSegments.slice(1));
    } else if (
      rawSegments.length >= 3 &&
      isValidRawIdSegment(rawSegments[0]) &&
      rawSegments[1] === 'file'
    ) {
      // Long format: {workspace-id}/file/{workspace-relative-path}
      workspaceId = rawSegments[0];
      resourceType = 'file';
      resourceId = decodeFilePathSegments(rawSegments.slice(2));
    } else if (
      rawSegments.length === 5 &&
      rawSegments[1] === 'agent' &&
      rawSegments[3] === 'message' &&
      isValidRawIdSegment(rawSegments[0]) &&
      isValidRawIdSegment(rawSegments[2]) &&
      isValidRawIdSegment(rawSegments[4]) &&
      pathSegments.length === 5 &&
      pathSegments[1] === 'agent' &&
      pathSegments[3] === 'message'
    ) {
      workspaceId = pathSegments[0];
      resourceType = 'message';
      agentId = pathSegments[2];
      resourceId = pathSegments[4];
    } else if (pathSegments[0] === 'note' || pathSegments[0] === 'task') {
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

    if (resourceType === 'file') {
      const parsedFilePath = parseFilePathLineSuffix(resourceId + urlObj.hash);
      resourceId = parsedFilePath.path;
      line = parsedFilePath.line;

      // Reject traversal-looking or absolute paths (e.g. "..", encoded slashes)
      if (!isSafeWorkspaceRelativePath(resourceId)) {
        return {
          type: 'unknown',
          orgId,
          workspaceId,
          resourceId: '',
          valid: false,
          error: m.ui_linkHandler_invalidFilePath_error(),
        };
      }
      return {
        type: 'file',
        orgId,
        workspaceId,
        resourceId,
        ...(line !== undefined ? { line } : {}),
        valid: true,
      };
    }

    if (resourceType === 'message' && workspaceId && agentId) {
      return {
        type: 'message',
        orgId,
        workspaceId,
        resourceId,
        agentId,
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
 * Percent-decode file path segments and join them into a workspace-relative path
 */
function decodeFilePathSegments(segments: string[]): string {
  return segments.map((segment) => decodeURIComponent(segment)).join('/');
}

/**
 * A safe workspace-relative path has only non-empty components and no "." /
 * ".." dot components. Empty components also reject absolute paths (leading
 * slash) and doubled slashes; Windows drive-letter prefixes (C:/..., C:foo)
 * are rejected as absolute/drive-relative.
 */
function isSafeWorkspaceRelativePath(path: string): boolean {
  if (/^[A-Za-z]:/.test(path)) {
    return false;
  }
  const components = path.split(/[\\/]/);
  return components.every(
    (component) => component.length > 0 && component !== '.' && component !== '..',
  );
}

/**
 * A raw ID segment must not be a "." / ".." dot component (literal or
 * percent-encoded) or contain path separators. Validate before using the URL
 * parser's normalized path segments.
 */
function isValidRawIdSegment(segment: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return false;
  }
  return decoded.length > 0 && decoded !== '.' && decoded !== '..' && !/[\\/]/.test(decoded);
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
