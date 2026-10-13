import { parseIntentLink } from '$shared/utils/intent-link-parser';

export function parseWorkspaceFileTarget(path: string) {
  return parseIntentLink(
    `intent://local/file/${path.split('/').map(encodeURIComponent).join('/')}`,
  );
}
