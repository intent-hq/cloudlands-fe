import { mount, unmount, type ComponentProps } from 'svelte';
import MediaUnavailable from '$lib/components/ui/MediaUnavailable.svelte';
import MediaLoadingPlaceholder from '$lib/components/ui/MediaLoadingPlaceholder.svelte';
import VideoActionsMenu from '$lib/components/ui/VideoActionsMenu.svelte';
import { parseWorkspaceFileImageUrl } from '$lib/utils/image-actions';
import {
  imageRetryUrl,
  parseIntentFileTarget,
  markedMediaUnavailableReason,
  workspaceAssetVideoSource,
} from '$lib/utils/workspace-file-image';
import { IMAGE_SIZED_ATTR } from '$lib/utils/markdown-image-dimensions';
import { isActionableImage, sizedImageLabel } from './markdown-image-dom';

interface MediaFallbackOptions {
  getWorkspaceId: () => string | undefined;
  canUseMedia: (source: string) => boolean;
  onMediaRemoved: (media: HTMLImageElement | HTMLVideoElement) => void;
}

const IMAGE_FRAME_CLASS = 'markdown-image-frame';

export function markdownMediaFallbacks(node: HTMLElement, options: MediaFallbackOptions) {
  const mountedPlaceholders = new Map<HTMLElement, ReturnType<typeof mount>>();
  const imageLoads = new Map<
    HTMLImageElement,
    {
      source: string;
      workspaceId: string | undefined;
      retries: number;
      failureHandled: boolean;
      timer?: ReturnType<typeof setTimeout>;
      fallbackHost?: HTMLElement;
    }
  >();
  const frameLoadListeners = new Map<HTMLImageElement, () => void>();
  const retryDelays = [300, 1_000];
  let destroyed = false;

  function loadState(image: HTMLImageElement) {
    let state = imageLoads.get(image);
    if (!state) {
      state = {
        source: image.getAttribute('src') || '',
        workspaceId: options.getWorkspaceId(),
        retries: 0,
        failureHandled: false,
      };
      imageLoads.set(image, state);
    }
    return state;
  }

  function canRetryImage(image: HTMLImageElement) {
    const state = loadState(image);
    return (
      !destroyed &&
      node.contains(state.fallbackHost ?? image) &&
      state.workspaceId === options.getWorkspaceId() &&
      options.canUseMedia(state.source) &&
      !image.hasAttribute('data-media-unavailable') &&
      !image.hasAttribute('data-media-unsupported') &&
      imageRetryUrl(state.source) !== null
    );
  }

  function retryImage(image: HTMLImageElement, manual = false) {
    if (!canRetryImage(image)) return;
    const state = loadState(image);
    const source = imageRetryUrl(state.source);
    if (!source) return;
    const host = state.fallbackHost;
    const restoreFocus = host?.contains(document.activeElement) ?? false;
    state.failureHandled = false;
    state.fallbackHost = undefined;
    if (manual) state.retries = 0;
    // Removing src first makes even an unchanged signed HTTP URL a fresh load.
    image.removeAttribute('src');
    image.setAttribute('src', source);
    if (host) {
      const component = mountedPlaceholders.get(host);
      if (component) void unmount(component);
      mountedPlaceholders.delete(host);
      host.replaceWith(image);
      reconcile();
      if (restoreFocus && node.contains(image)) image.focus();
    }
  }

  function imageFailed(image: HTMLImageElement) {
    const state = loadState(image);
    if (destroyed || !node.contains(image) || state.failureHandled) return;
    state.failureHandled = true;
    if (canRetryImage(image) && state.retries < retryDelays.length) {
      state.timer = setTimeout(() => {
        state.timer = undefined;
        retryImage(image);
      }, retryDelays[state.retries++]);
    } else {
      replaceMedia(image, 'load-failed');
    }
  }

  function imageFrame(media: HTMLElement): HTMLElement | null {
    const parent = media.parentElement;
    return parent?.classList.contains(IMAGE_FRAME_CLASS) ? parent : null;
  }

  // Reserve sidecar dimensions and show a placeholder until image bytes arrive.
  function frameSizedImage(image: HTMLImageElement) {
    const width = Number(image.getAttribute('width'));
    const height = Number(image.getAttribute('height'));
    if (!(width > 0 && height > 0)) return;
    const frame = document.createElement('span');
    frame.className = IMAGE_FRAME_CLASS;
    frame.style.aspectRatio = `${width} / ${height}`;
    frame.style.setProperty('--image-aspect-ratio', `${width} / ${height}`);
    frame.style.width = `min(${width}px, 100%)`;
    frame.dataset.loaded = 'false';
    image.replaceWith(frame);
    frame.appendChild(image);
    const placeholderHost = frame.appendChild(document.createElement('span'));
    placeholderHost.className = 'markdown-image-frame-placeholder';
    mountedPlaceholders.set(
      placeholderHost,
      mount(MediaLoadingPlaceholder, {
        target: placeholderHost,
        props: { name: sizedImageLabel(image, options.getWorkspaceId()) },
      }),
    );
    const reveal = () => {
      frameLoadListeners.delete(image);
      if (destroyed || !node.contains(frame)) return;
      frame.dataset.loaded = 'true';
      const placeholder = mountedPlaceholders.get(placeholderHost);
      if (placeholder) {
        void unmount(placeholder);
        mountedPlaceholders.delete(placeholderHost);
      }
      placeholderHost.remove();
    };
    if (image.complete && image.naturalWidth > 0) reveal();
    else {
      frameLoadListeners.set(image, reveal);
      image.addEventListener('load', reveal, { once: true });
    }
  }

  function replaceMedia(
    media: HTMLImageElement | HTMLVideoElement,
    reason: ComponentProps<typeof MediaUnavailable>['reason'],
  ) {
    const source = media.getAttribute('src') || media.getAttribute('data-media-src') || '';
    const workspaceFile = parseWorkspaceFileImageUrl(source);
    const intentFile = parseIntentFileTarget(source, options.getWorkspaceId());
    const path = workspaceFile?.path ?? intentFile?.path;
    const owningWorkspaceId = workspaceFile?.workspaceId ?? intentFile?.workspaceId;
    const name =
      media.getAttribute('data-name') ||
      media.getAttribute('alt') ||
      path?.split('/').pop() ||
      undefined;
    const host = document.createElement(media instanceof HTMLVideoElement ? 'div' : 'span');
    host.className = 'media-unavailable-host';
    (imageFrame(media) ?? media).replaceWith(host);
    options.onMediaRemoved(media);
    let onRetry: (() => void) | undefined;
    if (media instanceof HTMLImageElement && reason === 'load-failed') {
      const state = loadState(media);
      state.fallbackHost = host;
      if (canRetryImage(media)) onRetry = () => retryImage(media, true);
    }
    const fallback = mount(MediaUnavailable, {
      target: host,
      props: { name, reason, path, workspaceId: owningWorkspaceId, onRetry },
    });
    mountedPlaceholders.set(host, fallback);
    if (media instanceof HTMLVideoElement) {
      host.classList.add('flex', 'items-center', 'gap-2');
      const actionsHost = host.appendChild(document.createElement('span'));
      mountedPlaceholders.set(
        actionsHost,
        mount(VideoActionsMenu, {
          target: actionsHost,
          props: {
            videoUrl: source,
            videoName: name,
            sourceKind: 'workspace',
            mimeType: workspaceAssetVideoSource(source, options.getWorkspaceId())?.mimeType,
          },
        }),
      );
    }
  }

  function reconcile() {
    if (destroyed) return;
    for (const image of node.querySelectorAll<HTMLImageElement>('img')) {
      if (isActionableImage(image) && !image.closest('a')) {
        image.tabIndex = 0;
        image.setAttribute('role', 'button');
      }
      if (
        image.hasAttribute('data-media-unsupported') ||
        image.hasAttribute('data-media-unavailable')
      )
        continue;
      loadState(image);
      if (image.hasAttribute(IMAGE_SIZED_ATTR) && !imageFrame(image)) frameSizedImage(image);
      // Cached failures can finish before the capturing error listener is installed.
      if (image.getAttribute('src') && image.complete && image.naturalWidth === 0)
        imageFailed(image);
    }
    for (const media of node.querySelectorAll<HTMLImageElement>('[data-media-unsupported]')) {
      replaceMedia(media, 'unsupported');
    }
    for (const media of node.querySelectorAll<HTMLImageElement>('[data-media-unavailable]')) {
      replaceMedia(media, markedMediaUnavailableReason(media));
    }
    for (const [image, state] of imageLoads) {
      if (!node.contains(state.fallbackHost ?? image)) {
        if (state.timer !== undefined) clearTimeout(state.timer);
        imageLoads.delete(image);
      }
    }
    for (const [image, listener] of frameLoadListeners) {
      if (!node.contains(image)) {
        image.removeEventListener('load', listener);
        frameLoadListeners.delete(image);
      }
    }
    for (const [host, component] of mountedPlaceholders) {
      if (!node.contains(host)) {
        void unmount(component);
        mountedPlaceholders.delete(host);
      }
    }
  }

  function handleMediaError(event: Event) {
    const media = event.target;
    if (!(media instanceof HTMLImageElement || media instanceof HTMLVideoElement)) return;
    // Decode and transport errors do not establish that the underlying asset is absent.
    if (media instanceof HTMLImageElement) imageFailed(media);
    else replaceMedia(media, 'load-failed');
  }

  const observer = new MutationObserver(reconcile);
  observer.observe(node, { childList: true, subtree: true });
  node.addEventListener('error', handleMediaError, true);
  queueMicrotask(reconcile);

  return {
    destroy() {
      destroyed = true;
      observer.disconnect();
      for (const state of imageLoads.values()) {
        if (state.timer !== undefined) clearTimeout(state.timer);
      }
      imageLoads.clear();
      for (const [image, listener] of frameLoadListeners)
        image.removeEventListener('load', listener);
      frameLoadListeners.clear();
      node.removeEventListener('error', handleMediaError, true);
      for (const component of mountedPlaceholders.values()) void unmount(component);
      mountedPlaceholders.clear();
    },
  };
}
