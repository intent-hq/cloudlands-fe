import { supportsImageActions } from '$lib/utils/image-actions';

/** Marks a container (the chat transcript) whose image openers form one gallery. */
const LIGHTBOX_GALLERY_ATTRIBUTE = 'data-lightbox-gallery';
/** Marks a control that opens an image lightbox when clicked. */
const LIGHTBOX_OPENER_ATTRIBUTE = 'data-lightbox-opener';

const OPENER_SELECTOR = `[${LIGHTBOX_OPENER_ATTRIBUTE}], .markdown-content img`;

function isOpener(element: HTMLElement): boolean {
  if (element.hasAttribute(LIGHTBOX_OPENER_ATTRIBUTE)) {
    return !(element instanceof HTMLButtonElement && element.disabled);
  }
  // Markdown opens a bare supported image; a linked image follows its link.
  return (
    element instanceof HTMLImageElement &&
    !element.closest('a') &&
    supportsImageActions(element.getAttribute('src') || '')
  );
}

/**
 * The opener before (`-1`) or after (`1`) `opener` in document order inside
 * its gallery, or null at either end or outside a gallery.
 */
export function adjacentLightboxOpener(
  opener: HTMLElement | null,
  direction: 1 | -1,
): HTMLElement | null {
  const gallery = opener?.closest(`[${LIGHTBOX_GALLERY_ATTRIBUTE}]`);
  if (!opener || !gallery) return null;
  const openers = Array.from(gallery.querySelectorAll<HTMLElement>(OPENER_SELECTOR)).filter(
    isOpener,
  );
  const index = openers.findIndex((element) => element === opener || element.contains(opener));
  if (index < 0) return null;
  return openers[index + direction] ?? null;
}
