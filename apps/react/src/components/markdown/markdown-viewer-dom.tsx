// DOM lifecycle from MarkdownViewer.svelte. Portals retain the viewer's React contexts.
import {
  useCallback,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { MediaLoadingPlaceholder } from '@/components/ui/media-loading-placeholder';
import { MediaUnavailable, type MediaUnavailableReason } from '@/components/ui/media-unavailable';
import { VideoActionsMenu } from '@/components/ui/video-actions-menu';
import { filterFileMedia } from '$lib/utils/media-provenance';
import { parseWorkspaceFileImageUrl } from '$lib/utils/image-actions';
import { parseIntentFileTarget, workspaceAssetVideoSource } from '$lib/utils/workspace-file-image';
import { IMAGE_SIZED_ATTR } from '$lib/utils/markdown-image-dimensions';
import { isActionableImage, sizedImageLabel } from '$lib/components/markdown/markdown-image-dom';
import type { MarkdownViewerProps } from './markdown-viewer';
import { useMarkdownDiagrams } from './markdown-viewer-diagrams';

interface MarkdownViewerDomProps {
  className: string;
  html: string;
  workspaceId?: string;
  allowFileMedia: boolean;
  canLoadMedia?: MarkdownViewerProps['canLoadMedia'];
  canOpenFile?: () => boolean;
  renderDiagrams: boolean;
  onOpenLink: MarkdownViewerProps['onOpenLink'];
  onOpenFile: MarkdownViewerProps['onOpenFile'];
  onElement: (element: HTMLDivElement | null) => void;
  onMediaRemoved: (media: HTMLImageElement | HTMLVideoElement) => void;
  overlay: ReactNode;
}

type Placeholder = {
  node: HTMLElement;
  host: HTMLElement;
  key: number;
} & (
  | { kind: 'loading'; name?: string }
  | {
      kind: 'unavailable';
      name?: string;
      reason: MediaUnavailableReason;
      path?: string;
      workspaceId?: string;
      video?: { source: string; mimeType?: string };
    }
);
const IMAGE_FRAME_CLASS = 'markdown-image-frame';

export function MarkdownViewerDom({
  className,
  html,
  workspaceId,
  allowFileMedia,
  canLoadMedia,
  canOpenFile,
  renderDiagrams,
  onOpenLink,
  onOpenFile,
  onElement,
  onMediaRemoved,
  overlay,
}: MarkdownViewerDomProps) {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const bindNode = useCallback(
    (element: HTMLDivElement | null) => {
      setNode(element);
      onElement(element);
    },
    [onElement],
  );
  const range = useRef<{ start: Comment; end: Comment; html: string | null } | null>(null);
  const [placeholders, setPlaceholders] = useState<Placeholder[]>([]);
  const nextKey = useRef(0);
  const getWorkspaceId = useEffectEvent(() => workspaceId);
  const mediaRemoved = useEffectEvent(onMediaRemoved);

  function removePublishedContent(contents: Range, owner: HTMLElement) {
    const images = [...owner.querySelectorAll<HTMLImageElement>('img')].filter((image) =>
      contents.intersectsNode(image),
    );
    contents.deleteContents();
    // Framing can reparent an image inside this viewer; only actual removal ends ownership.
    for (const image of images) {
      if (!owner.contains(image)) mediaRemoved(image);
    }
  }

  useLayoutEffect(() => {
    if (!node) return;
    const start = document.createComment('markdown-start');
    const end = document.createComment('markdown-end');
    // Keep the image actions portal outside the HTML replacement range, at the same depth.
    node.prepend(start, end);
    range.current = { start, end, html: null };
    return () => {
      const contents = document.createRange();
      contents.setStartAfter(start);
      contents.setEndBefore(end);
      removePublishedContent(contents, node);
      start.remove();
      end.remove();
      range.current = null;
    };
  }, [node]);

  // Check current authority at DOM publication, even if the callback identity did not change.
  // Both filtering and parsing happen in inert templates; no disallowed src reaches the DOM.
  useLayoutEffect(() => {
    const target = range.current;
    if (!node || !target) return;
    const admitted = filterFileMedia(
      html,
      allowFileMedia && canOpenFile?.() !== false,
      canLoadMedia,
    );
    if (target.html === admitted) return;
    const template = document.createElement('template');
    template.innerHTML = admitted;
    const contents = document.createRange();
    contents.setStartAfter(target.start);
    contents.setEndBefore(target.end);
    removePublishedContent(contents, node);
    target.end.before(template.content);
    target.html = admitted;
  });

  useLayoutEffect(() => {
    if (!node) return;
    let disposed = false;
    const mountedPlaceholders = new Map<HTMLElement, Placeholder>();
    const loadingImages = new Map<HTMLImageElement, () => void>();
    function publish() {
      if (!disposed) setPlaceholders([...mountedPlaceholders.values()]);
    }
    function imageFrame(media: HTMLElement): HTMLElement | null {
      const parent = media.parentElement;
      return parent?.classList.contains(IMAGE_FRAME_CLASS) ? parent : null;
    }
    function frameSizedImage(image: HTMLImageElement) {
      const width = Number(image.getAttribute('width'));
      const height = Number(image.getAttribute('height'));
      if (!(width > 0 && height > 0)) return;
      const frame = document.createElement('span');
      frame.className = IMAGE_FRAME_CLASS;
      frame.style.aspectRatio = `${width} / ${height}`;
      frame.style.width = `min(${width}px, 100%)`;
      frame.dataset.loaded = 'false';
      image.replaceWith(frame);
      frame.appendChild(image);
      const placeholderHost = frame.appendChild(document.createElement('span'));
      placeholderHost.className = 'markdown-image-frame-placeholder';
      mountedPlaceholders.set(placeholderHost, {
        kind: 'loading',
        node: node!,
        host: placeholderHost,
        key: nextKey.current++,
        name: sizedImageLabel(image, getWorkspaceId()),
      });
      const reveal = () => {
        loadingImages.delete(image);
        if (disposed || !node?.contains(frame)) return;
        frame.dataset.loaded = 'true';
        mountedPlaceholders.delete(placeholderHost);
        placeholderHost.remove();
        publish();
      };
      if (image.complete && image.naturalWidth > 0) reveal();
      else {
        loadingImages.set(image, reveal);
        image.addEventListener('load', reveal, { once: true });
      }
    }
    function replaceMedia(
      media: HTMLImageElement | HTMLVideoElement,
      reason: MediaUnavailableReason,
    ) {
      const source = media.getAttribute('src') || media.getAttribute('data-media-src') || '';
      const workspaceFile = parseWorkspaceFileImageUrl(source);
      const intentFile = parseIntentFileTarget(source, getWorkspaceId());
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
      mediaRemoved(media);
      if (media instanceof HTMLVideoElement) host.classList.add('flex', 'items-center', 'gap-2');
      mountedPlaceholders.set(host, {
        kind: 'unavailable',
        node: node!,
        host,
        key: nextKey.current++,
        name,
        reason,
        path,
        workspaceId: owningWorkspaceId,
        ...(media instanceof HTMLVideoElement
          ? {
              video: {
                source,
                mimeType: workspaceAssetVideoSource(source, getWorkspaceId())?.mimeType,
              },
            }
          : {}),
      });
    }
    function reconcile() {
      if (disposed || !node) return;
      const before = [...mountedPlaceholders.values()];
      for (const image of node.querySelectorAll<HTMLImageElement>('img')) {
        if (isActionableImage(image) && !image.closest('a')) {
          image.tabIndex = 0;
          image.setAttribute('role', 'button');
        }
        if (image.hasAttribute(IMAGE_SIZED_ATTR) && !imageFrame(image)) frameSizedImage(image);
      }
      for (const media of node.querySelectorAll<HTMLImageElement>('[data-media-unsupported]')) {
        replaceMedia(media, 'unsupported');
      }
      for (const media of node.querySelectorAll<HTMLImageElement>('[data-media-unavailable]')) {
        replaceMedia(media, 'load-failed');
      }
      for (const host of mountedPlaceholders.keys()) {
        if (!node.contains(host)) mountedPlaceholders.delete(host);
      }
      for (const [image, reveal] of loadingImages) {
        if (!node.contains(image)) {
          image.removeEventListener('load', reveal);
          loadingImages.delete(image);
        }
      }
      const after = [...mountedPlaceholders.values()];
      if (before.length !== after.length || before.some((entry, index) => entry !== after[index]))
        publish();
    }
    function handleMediaError(event: Event) {
      const media = event.target;
      if (!(media instanceof HTMLImageElement || media instanceof HTMLVideoElement)) return;
      if (disposed || !node?.contains(media)) return;
      replaceMedia(media, 'load-failed');
      publish();
    }
    const observer = new MutationObserver(reconcile);
    observer.observe(node, { childList: true, subtree: true });
    node.addEventListener('error', handleMediaError, true);
    queueMicrotask(reconcile);
    return () => {
      disposed = true;
      observer.disconnect();
      node.removeEventListener('error', handleMediaError, true);
      for (const [image, reveal] of loadingImages) image.removeEventListener('load', reveal);
      loadingImages.clear();
      mountedPlaceholders.clear();
      setPlaceholders([]);
    };
  }, [node]);

  const diagrams = useMarkdownDiagrams(node, {
    enabled: renderDiagrams,
    workspaceId,
    onOpenFile,
    onOpenLink: (url, options) => {
      void onOpenLink(url, options);
    },
  });
  return (
    <>
      {/* Native delegated events belong to the viewer; HTML children preserve source semantics. */}
      {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Preserve the source Markdown group without introducing fieldset semantics or layout. */}
      <div ref={bindNode} role="group" className={className} />
      {node ? createPortal(overlay, node, 'image-actions') : null}
      {placeholders
        .filter((entry) => entry.node === node)
        .map((entry) =>
          createPortal(
            entry.kind === 'loading' ? (
              <MediaLoadingPlaceholder name={entry.name} />
            ) : (
              <>
                <MediaUnavailable
                  name={entry.name}
                  reason={entry.reason}
                  path={entry.path}
                  workspaceId={entry.workspaceId}
                  onOpenLink={onOpenLink}
                />
                {entry.video ? (
                  <span>
                    <VideoActionsMenu
                      videoUrl={entry.video.source}
                      videoName={entry.name}
                      sourceKind="workspace"
                      mimeType={entry.video.mimeType}
                    />
                  </span>
                ) : null}
              </>
            ),
            entry.host,
            String(entry.key),
          ),
        )}
      {diagrams}
    </>
  );
}
