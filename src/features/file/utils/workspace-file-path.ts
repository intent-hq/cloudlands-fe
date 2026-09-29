import { isAbsolutePath, isTildePath } from '$lib/utils/path-utils';

/** Convert a viewer/tree path to a contained workspace-relative file path. */
export function workspaceRelativeFilePath(
  filePath: string | null | undefined,
  root: string | null | undefined,
): string | null {
  if (!filePath || isTildePath(filePath)) return null;
  const normalized = filePath.replace(/\\/g, '/');
  let relativePath = normalized;
  if (isAbsolutePath(filePath)) {
    if (!root) return null;
    const normalizedRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
    const caseInsensitive = /^[A-Za-z]:\//.test(normalizedRoot) || normalizedRoot.startsWith('//');
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
