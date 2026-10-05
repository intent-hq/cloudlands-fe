import { parseWorkspaceFileImageUrl, supportsImageActions } from '$lib/utils/image-actions';
import { parseIntentFileTarget } from '$lib/utils/workspace-file-image';

export function isActionableImage(image: HTMLImageElement): boolean {
  return supportsImageActions(image.getAttribute('src') || '');
}

export function imageAtTarget(target: EventTarget | null): HTMLImageElement | null {
  return target instanceof HTMLImageElement
    ? target
    : target instanceof HTMLAnchorElement
      ? target.querySelector('img')
      : null;
}

export function imageActionsPosition(image: HTMLImageElement, container: HTMLElement) {
  const imageRect = image.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  return {
    top: imageRect.top - containerRect.top + 6,
    right: containerRect.right - imageRect.right + 6,
  };
}

export function imageActionsHaveFocus(
  image: HTMLImageElement | null,
  overlay: HTMLElement | null,
): boolean {
  const active = document.activeElement;
  return Boolean(
    active && (active === image || active === image?.closest('a') || overlay?.contains(active)),
  );
}

/** Workspace path or asset name shown while a sized image is still loading. */
export function sizedImageLabel(image: HTMLImageElement, workspaceId?: string): string | undefined {
  const source = image.getAttribute('src') || '';
  const path =
    parseWorkspaceFileImageUrl(source)?.path ?? parseIntentFileTarget(source, workspaceId)?.path;
  if (path) return path;
  if (source.startsWith('workspace-asset://')) {
    const assetName = source.split(/[?#]/)[0].split('/').pop();
    if (assetName) return assetName;
  }
  // Bare workspace-relative paths (`![x](docs/diagram.png)`) are a supported
  // media-key shape; the path itself is the most useful label.
  if (source && !/^[a-z][a-z0-9+.-]*:/i.test(source) && !source.startsWith('//')) {
    try {
      return decodeURI(source);
    } catch {
      return source;
    }
  }
  return image.getAttribute('alt') || undefined;
}
