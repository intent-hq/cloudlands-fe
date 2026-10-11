import { store } from '@/store';
import { linkTooltipHidden, linkTooltipRequested } from '@/store/link-tooltip/link-tooltip-slice';

// The source public API accepts a DOM anchor. Keep only its DOM lifetime here;
// request identity, visibility and preview data belong to the configured ReactStore.
let nextRequestId = 0;
let current: { id: number; anchor: HTMLAnchorElement; stop: () => void } | undefined;

export function getLinkTooltipAnchor(requestId: number): HTMLAnchorElement | undefined {
  return current?.id === requestId ? current.anchor : undefined;
}

export function hideLinkTooltip(requestId?: number): void {
  if (requestId !== undefined && current?.id !== requestId) return;
  current?.stop();
  current = undefined;
  store.dispatch(linkTooltipHidden(requestId));
}

/** Called by the host when its saga retires the originating request. */
export function releaseLinkTooltipAnchor(requestId: number): void {
  if (current?.id !== requestId) return;
  current.stop();
  current = undefined;
}

/** Source show/hide API, with delay and preview work owned by linkTooltipSaga. */
export function showLinkTooltip(
  anchor: HTMLAnchorElement,
  url: string,
  workspaceId?: string,
): void {
  current?.stop();
  const id = ++nextRequestId;
  const surface = anchor.closest<HTMLElement>('[data-workspace-surface]');
  const originalWorkspace = workspaceId ?? surface?.dataset.workspaceSurface;
  const originalHref = anchor.href;
  const isCurrent = () =>
    anchor.isConnected &&
    anchor.href === originalHref &&
    (!surface ||
      (surface.contains(anchor) && surface.dataset.workspaceSurface === originalWorkspace));
  const observer = new MutationObserver(() => {
    if (!isCurrent()) hideLinkTooltip(id);
  });
  observer.observe(anchor.ownerDocument.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-workspace-surface', 'href'],
  });
  current = { id, anchor, stop: () => observer.disconnect() };
  store.dispatch(linkTooltipRequested({ id, url, workspaceId: originalWorkspace }));
  if (!isCurrent()) hideLinkTooltip(id);
}

/** Hover delegation only; product link navigation remains with its own owner. */
export function createLinkTooltipHandler(
  container: HTMLElement,
  options: { workspaceId?: string } = {},
): () => void {
  let currentAnchor: HTMLAnchorElement | null = null;
  let requestId: number | undefined;
  const hide = () => {
    currentAnchor = null;
    if (requestId !== undefined) hideLinkTooltip(requestId);
    requestId = undefined;
  };
  const over = (event: MouseEvent) => {
    const anchor = event.target instanceof Element ? event.target.closest('a') : null;
    if (
      !anchor?.href ||
      anchor.href.startsWith('intent://') ||
      anchor.href.startsWith('devspace://')
    ) {
      if (currentAnchor) hide();
      return;
    }
    if (anchor === currentAnchor) return;
    currentAnchor = anchor;
    const workspaceId =
      options.workspaceId ??
      anchor.closest<HTMLElement>('[data-workspace-id]')?.dataset.workspaceId ??
      anchor.closest<HTMLElement>('[data-workspace-surface]')?.dataset.workspaceSurface;
    showLinkTooltip(anchor, anchor.href, workspaceId);
    requestId = current?.id;
  };
  const out = (event: MouseEvent) => {
    const anchor = event.target instanceof Element ? event.target.closest('a') : null;
    if (!anchor || anchor !== currentAnchor) return;
    if (event.relatedTarget instanceof Node && anchor.contains(event.relatedTarget)) return;
    hide();
  };
  container.addEventListener('mouseover', over);
  container.addEventListener('mouseout', out);
  container.addEventListener('click', hide);
  return () => {
    container.removeEventListener('mouseover', over);
    container.removeEventListener('mouseout', out);
    container.removeEventListener('click', hide);
    hide();
  };
}
