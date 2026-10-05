import { isAbsolutePath, isTildePath } from '$lib/utils/path-utils';

/** Convert a viewer/tree path to a contained workspace-relative file path. */
export function workspaceRelativeFilePath(
  filePath: string | null | undefined,
  root: string | null | undefined,
): string | null {
  if (!filePath || isTildePath(filePath)) return null;
  // A backslash is a filename character on POSIX, not a separator. Prefer
  // the workspace root to disambiguate relative paths from Windows paths.
  const windowsStyle = /^[A-Za-z]:[/\\]|^[/\\]{2}/.test(root ?? filePath);
  const normalized = windowsStyle ? filePath.replace(/\\/g, '/') : filePath;
  let relativePath = normalized;
  if (isAbsolutePath(filePath)) {
    if (!root) return null;
    const normalizedRoot = (windowsStyle ? root.replace(/\\/g, '/') : root).replace(/\/+$/, '');
    const caseInsensitive = windowsStyle;
    const comparedPath = caseInsensitive ? normalized.toLowerCase() : normalized;
    const comparedRoot = caseInsensitive ? normalizedRoot.toLowerCase() : normalizedRoot;
    if (!comparedPath.startsWith(`${comparedRoot}/`)) return null;
    relativePath = normalized.slice(normalizedRoot.length + 1);
  }
  const segments = relativePath.split('/');
  if (
    segments.some(
      (segment) => !segment || segment === '.' || segment === '..' || segment.includes('\0'),
    ) ||
    /^[A-Za-z]:/.test(segments[0])
  )
    return null;
  return segments.join('/');
}
