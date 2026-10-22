import { stripWorkspacePrefix } from '$lib/utils/file-utils';
import { intentFileImageUrlToWorkspaceFileUrl } from '$lib/utils/workspace-file-image';

/** Resolve read paths through the existing workspace media allowlist. */
export function resolveLocalToolImageSource(
  path: string,
  workspaceId?: string,
  workspacePath?: string,
): string | null {
  if (/^[a-z][a-z\d+.-]*:/i.test(path)) return null;
  const relativePath = workspacePath
    ? stripWorkspacePrefix(path, workspacePath.replace(/\/+$/, ''))
    : path;
  if (!relativePath || relativePath.startsWith('/')) return null;
  const encodedPath = relativePath.split('/').map(encodeURIComponent).join('/');
  return intentFileImageUrlToWorkspaceFileUrl(`intent://local/file/${encodedPath}`, workspaceId);
}
