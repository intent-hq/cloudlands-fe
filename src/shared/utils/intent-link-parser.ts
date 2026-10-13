import { m } from '../paraglide/messages.js';
import { parseFilePathLineSuffix } from './link-helpers';

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
      const lineFragment = /^#L\d+(?:-\d+|C\d+)?$/.test(urlObj.hash) ? urlObj.hash : '';
      // Parse location syntax before decoding: %23L42 and %3A17 belong to the
      // filename, even when followed by a separate unescaped line location.
      const encodedPath = rawSegments.slice(workspaceId ? 2 : 1).join('/');
      const parsedFilePath = parseFilePathLineSuffix(encodedPath + lineFragment);
      resourceId = decodeFilePathSegments(parsedFilePath.path.split('/'));
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
