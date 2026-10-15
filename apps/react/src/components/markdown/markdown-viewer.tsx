// Source: src/lib/components/markdown/MarkdownViewer.svelte.
import { useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ImageLightbox } from '@/components/ui/image-lightbox';
import { ImageActionsMenu, type ImageActionsMenuHandle } from '@/components/ui/image-actions-menu';
import { ChatVideoBlock } from '@/features/chat/components/chat-video-block';
import { canLoadMediaUrl } from '$lib/utils/media-provenance';
import { classifyMarkdownContent } from '$lib/utils/markdown-content-complexity';
import { logger } from '$lib/utils/client-logger';
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { splitWorkspaceVideoMarkdown } from '$lib/utils/workspace-file-video';
import { supportsImageActions } from '$lib/utils/image-actions';
import {
  imageActionsHaveFocus,
  imageActionsPosition,
  imageAtTarget,
  isActionableImage,
} from '$lib/components/markdown/markdown-image-dom';
import { createWorkspaceFileVersion } from '$lib/utils/workspace-file-image';
import { stampMarkdownImageDimensions } from '$lib/utils/markdown-image-dimensions';
import type { TextBlockMedia } from '$shared/types/content-block';
import { WorkspaceId } from '$shared/types/branded-ids';
import { isCmdClickModifier, type LinkHandlerOptions } from '$shared/utils/link-helpers';
import { MarkdownViewerDom } from './markdown-viewer-dom';
import { linkifyMarkdownText } from './markdown-text-links';
import '$lib/components/markdown/markdown-math.css';
import './markdown-viewer.css';

export interface MarkdownViewerProps {
  content: string;
  /** Source chat plain URLs, without rewriting explicit links or literal code. */
  linkifyPlainUrls?: boolean;
  isStreaming?: boolean;
  className?: string;
  workspaceId?: string;
  onCodeBlockAction?: (action: string, code: string, language?: string) => void;
  /** File-only policy; external web and note links remain usable. */
  canOpenFile?: () => boolean;
  /** Reactive authority for automatically loaded file media. */
  allowFileMedia?: boolean;
  /** Host capability check, applied in addition to file provenance. */
  canLoadMedia?: (url: string) => boolean;
  onFileClick?: (
    path: string,
    options?: { line?: number; openInAdjacentPanel?: boolean; sourcePanelId?: string },
  ) => void;
  taskBlockRenderMode?: 'placeholder' | 'content';
  /** Chat transcript only: render inline workspace-file images as fixed square thumbnails. */
  chatImageThumbnails?: boolean;
  /** Open all http(s) links directly in the external browser (e.g. release notes). */
  forceExternalLinks?: boolean;
  /** Show rich fenced blocks as source when no TipTap node views are mounted. */
  renderRichFencesAsCode?: boolean;
  /** Mount read-only diagrams while keeping other rich fences as visible source. */
  renderDiagrams?: boolean;
  /** GitHub-style embedded HTML, still sanitized before rendering. */
  allowSanitizedHtml?: boolean;
  /** PROTOCOL §7.1 dimensions keyed by Markdown src; reserve image space while loading. */
  media?: TextBlockMedia;
  /** Host route context replaces getWorkspaceRouteContext; pass undefined outside a workspace. */
  workspaceContext: Readonly<{ workspaceId: WorkspaceId | null }> | undefined;
  /** Canonical handleLink boundary, including its original native event and file policy. */
  onOpenLink: (url: string, options: LinkHandlerOptions) => boolean | Promise<boolean>;
  /** Host dispatches openWorkspaceFile; onFileClick still overrides file mentions only. */
  onOpenFile: (
    workspaceId: string,
    path: string,
    options?: { line?: number; openInAdjacentPanel?: boolean; sourcePanelId?: string },
  ) => void;
  /** Host dispatches openWorkspaceNote. File-only policy never disables note links. */
  onOpenNote: (
    workspaceId: string,
    noteId: string,
    options?: { openInAdjacentPanel?: boolean; sourcePanelId?: string },
  ) => void;
}

const STREAMING_THROTTLE_MS = 150;

export function MarkdownViewer({
  content,
  linkifyPlainUrls = false,
  isStreaming = false,
  className = '',
  workspaceContext,
  workspaceId = workspaceContext?.workspaceId ?? undefined,
  onCodeBlockAction,
  onFileClick,
  canOpenFile,
  allowFileMedia = true,
  canLoadMedia,
  taskBlockRenderMode = 'placeholder',
  chatImageThumbnails = false,
  forceExternalLinks = false,
  renderRichFencesAsCode = false,
  renderDiagrams = false,
  allowSanitizedHtml = false,
  media,
  onOpenLink,
  onOpenFile,
  onOpenNote,
}: MarkdownViewerProps) {
  const [workspaceFileVersion] = useState(createWorkspaceFileVersion);
  const mediaSegments = useMemo(
    () => splitWorkspaceVideoMarkdown(content, workspaceId),
    [content, workspaceId],
  );
  const hasVideoSegments = mediaSegments.some((segment) => segment.type === 'video');
  const markdownContent =
    !hasVideoSegments && mediaSegments.length === 1 && mediaSegments[0].type === 'markdown'
      ? mediaSegments[0].content
      : content;
  const contentComplexity = classifyMarkdownContent(markdownContent);
  const [processedContent, setProcessedContent] = useState('');
  const schedule = useRef({
    renderVersion: 0,
    lastUpdateTime: -Infinity,
    pendingUpdateTimer: null as ReturnType<typeof setTimeout> | null,
    pendingUpdate: null as (() => void) | null,
  });

  // Layout cleanup invalidates in-flight work at commit/unmount, before promise publication.
  useLayoutEffect(() => {
    const state = schedule.current;
    const options = {
      allowEmpty: true,
      skipIfHTML: false,
      preserveAnchors: true,
      taskBlockRenderMode,
      workspaceId,
      renderRichFencesAsCode: renderRichFencesAsCode || renderDiagrams,
      processPrimitives: !renderDiagrams,
      allowSanitizedHtml,
      renderMath: !isStreaming,
      workspaceFileVersion,
    };
    const version = ++state.renderVersion;
    async function updateContent() {
      try {
        const html = await processMarkdownToHTML(markdownContent, options);
        if (version !== state.renderVersion) return;
        setProcessedContent(
          stampMarkdownImageDimensions(
            linkifyPlainUrls ? linkifyMarkdownText(html) : html,
            media,
            options.workspaceId,
          ),
        );
      } catch (error) {
        if (version !== state.renderVersion) return;
        logger.error('Failed to process markdown:', error);
        const escaped = markdownContent.replace(
          /[&<>"']/g,
          (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m] || m,
        );
        setProcessedContent(`<p>${escaped}</p>`);
      }
    }
    function flushStreamingUpdate() {
      if (!state.pendingUpdate) return;
      const remaining = STREAMING_THROTTLE_MS - (performance.now() - state.lastUpdateTime);
      if (remaining > 0) {
        state.pendingUpdateTimer = setTimeout(() => {
          state.pendingUpdateTimer = null;
          flushStreamingUpdate();
        }, remaining);
        return;
      }
      const update = state.pendingUpdate;
      state.pendingUpdate = null;
      state.lastUpdateTime = performance.now();
      update();
    }
    if (isStreaming) {
      state.pendingUpdate = () => void updateContent();
      if (state.pendingUpdateTimer === null) flushStreamingUpdate();
    } else {
      if (state.pendingUpdateTimer !== null) clearTimeout(state.pendingUpdateTimer);
      state.pendingUpdateTimer = null;
      state.pendingUpdate = null;
      state.lastUpdateTime = -Infinity;
      void updateContent();
    }
    return () => {
      state.renderVersion += 1;
    };
  }, [
    markdownContent,
    linkifyPlainUrls,
    taskBlockRenderMode,
    workspaceId,
    renderRichFencesAsCode,
    renderDiagrams,
    allowSanitizedHtml,
    isStreaming,
    workspaceFileVersion,
    media,
  ]);
  useLayoutEffect(() => {
    const state = schedule.current;
    return () => {
      state.renderVersion += 1;
      if (state.pendingUpdateTimer !== null) clearTimeout(state.pendingUpdateTimer);
      state.pendingUpdateTimer = null;
      state.pendingUpdate = null;
      state.lastUpdateTime = -Infinity;
    };
  }, []);

  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxImageUrl, setLightboxImageUrl] = useState('');
  const [lightboxImageAlt, setLightboxImageAlt] = useState<string | undefined>(undefined);
  const [lightboxOpenerElement, setLightboxOpenerElement] = useState<HTMLElement | null>(null);
  const [hoveredImage, setHoveredImage] = useState<HTMLImageElement | null>(null);
  const [hoveredImagePosition, setHoveredImagePosition] = useState({ top: 0, right: 0 });
  const [imageActionsOpen, setImageActionsOpen] = useState(false);
  const imageActionsMenu = useRef<ImageActionsMenuHandle>(null);
  const imageActionsOverlayElement = useRef<HTMLDivElement>(null);
  const [contentElement, setContentElement] = useState<HTMLDivElement | null>(null);

  function canUseMedia(url: string) {
    return (
      canLoadMediaUrl(url, allowFileMedia && canOpenFile?.() !== false) &&
      canLoadMedia?.(url) !== false
    );
  }
  function handleImageInteraction(event: MouseEvent | FocusEvent): void {
    if (
      event.type === 'mouseover' &&
      imageActionsHaveFocus(hoveredImage, imageActionsOverlayElement.current)
    )
      return;
    const target = event.target;
    const image = imageAtTarget(target);
    if (image && isActionableImage(image) && canUseMedia(image.getAttribute('src') || '')) {
      if (hoveredImage === image) return;
      setHoveredImage(image);
      setHoveredImagePosition(imageActionsPosition(image, event.currentTarget as HTMLElement));
    } else if (hoveredImage && !imageActionsOpen) {
      if (target instanceof Node && imageActionsOverlayElement.current?.contains(target)) return;
      setHoveredImage(null);
    }
  }
  function handleImageHoverLeave(): void {
    if (
      !imageActionsOpen &&
      !imageActionsHaveFocus(hoveredImage, imageActionsOverlayElement.current)
    ) {
      setHoveredImage(null);
    }
  }
  function handleImageContextMenu(event: MouseEvent): void {
    const image = imageAtTarget(event.target);
    if (!image || !isActionableImage(image) || !canUseMedia(image.getAttribute('src') || ''))
      return;
    event.preventDefault();
    event.stopPropagation();
    handleImageInteraction(event);
    setImageActionsOpen(true);
  }
  function getSourcePanelId(event: MouseEvent | KeyboardEvent): string | undefined {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return undefined;
    return target.closest<HTMLElement>('[data-panel-id]')?.dataset.panelId;
  }
  function handleLinkClick(event: MouseEvent | KeyboardEvent): void {
    const target = event.target as HTMLElement;
    const anchor = target.closest('a');
    if (!anchor && target instanceof HTMLImageElement) {
      const src = target.getAttribute('src') || '';
      if (supportsImageActions(src) && canUseMedia(src)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        setLightboxImageUrl(src);
        setLightboxImageAlt(target.getAttribute('alt') || undefined);
        setLightboxOpenerElement(target);
        setLightboxOpen(true);
        return;
      }
    }
    if (anchor?.href) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const sourcePanelId = getSourcePanelId(event);
      const owningWorkspaceId = workspaceId ? WorkspaceId(workspaceId) : undefined;
      void onOpenLink(anchor.href, {
        workspaceId: owningWorkspaceId,
        canOpenFile,
        sourcePanelId,
        event,
        rawHref: anchor.getAttribute('href') ?? undefined,
        ...(forceExternalLinks ? { forceExternal: true } : {}),
      });
      return;
    }
    const mentionEl = target.closest('[data-mention]');
    if (mentionEl) {
      const type = mentionEl.getAttribute('data-type');
      const id = mentionEl.getAttribute('data-id') || '';
      const meta = JSON.parse(mentionEl.getAttribute('data-meta') || '{}');
      if (type === 'file') {
        if (canOpenFile?.() === false) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        const filePath = meta.fullPath || meta.path || meta.filename || id;
        logger.debug('[MarkdownViewer] File mention clicked', { filePath, meta });
        const sourcePanelId = getSourcePanelId(event);
        const openInAdjacentPanel = isCmdClickModifier({ event });
        if (onFileClick) {
          onFileClick(filePath, { line: meta.line, openInAdjacentPanel, sourcePanelId });
        } else if (workspaceId) {
          onOpenFile(workspaceId, filePath, {
            line: meta.line,
            openInAdjacentPanel,
            sourcePanelId,
          });
        }
      } else if (type === 'note') {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        const noteId = meta.noteId || id;
        logger.debug('[MarkdownViewer] Note mention clicked', { noteId, meta });
        const sourcePanelId = getSourcePanelId(event);
        const openInAdjacentPanel = isCmdClickModifier({ event });
        if (workspaceId) onOpenNote(workspaceId, noteId, { openInAdjacentPanel, sourcePanelId });
      }
    }
  }
  function handleImageCopy(event: KeyboardEvent | ClipboardEvent): void {
    const image = imageAtTarget(event.target);
    if (!image || !isActionableImage(image) || !canUseMedia(image.getAttribute('src') || ''))
      return;
    imageActionsMenu.current?.handleCopy(event, image.getAttribute('src') || '');
  }
  function handleLinkKeydown(event: KeyboardEvent): void {
    handleImageCopy(event);
    if (event.defaultPrevented) return;
    if (
      event.target instanceof HTMLImageElement &&
      isActionableImage(event.target) &&
      (event.key === 'Enter' || event.key === ' ')
    ) {
      handleLinkClick(event);
      return;
    }
    if (event.key !== 'Enter' || !isCmdClickModifier({ event })) return;
    handleLinkClick(event);
  }

  // Native listeners preserve currentTarget, platform modifiers and propagation ordering.
  const click = useEffectEvent(handleLinkClick);
  const keydown = useEffectEvent(handleLinkKeydown);
  const copy = useEffectEvent(handleImageCopy);
  const contextmenu = useEffectEvent(handleImageContextMenu);
  const interaction = useEffectEvent(handleImageInteraction);
  const leave = useEffectEvent(handleImageHoverLeave);
  useLayoutEffect(() => {
    if (!contentElement) return;
    contentElement.addEventListener('click', click);
    contentElement.addEventListener('keydown', keydown);
    contentElement.addEventListener('copy', copy);
    contentElement.addEventListener('contextmenu', contextmenu);
    contentElement.addEventListener('mouseover', interaction);
    contentElement.addEventListener('focusin', interaction);
    contentElement.addEventListener('mouseleave', leave);
    return () => {
      contentElement.removeEventListener('click', click);
      contentElement.removeEventListener('keydown', keydown);
      contentElement.removeEventListener('copy', copy);
      contentElement.removeEventListener('contextmenu', contextmenu);
      contentElement.removeEventListener('mouseover', interaction);
      contentElement.removeEventListener('focusin', interaction);
      contentElement.removeEventListener('mouseleave', leave);
    };
  }, [contentElement]);

  const overlay =
    hoveredImage && canUseMedia(hoveredImage.getAttribute('src') || '') ? (
      <div
        ref={imageActionsOverlayElement}
        className="image-actions-overlay absolute z-10 react-markdown-viewer-scope"
        style={{ top: hoveredImagePosition.top, right: hoveredImagePosition.right }}
        data-testid="markdown-image-actions-overlay"
      >
        <ImageActionsMenu
          ref={imageActionsMenu}
          imageUrl={hoveredImage.getAttribute('src') || ''}
          imageName={hoveredImage.getAttribute('alt') || undefined}
          open={imageActionsOpen}
          onOpenChange={setImageActionsOpen}
        />
      </div>
    ) : null;
  return (
    <>
      {hasVideoSegments ? (
        <div className={`markdown-video-segments react-markdown-viewer-scope ${className}`}>
          {mediaSegments.map((segment, index) =>
            segment.type === 'video' ? (
              <ChatVideoBlock
                key={index}
                allowFileMedia={allowFileMedia}
                canLoadMedia={canLoadMedia}
                canOpenFile={canOpenFile}
                source={segment.source}
                name={segment.name}
                poster={segment.poster}
                onOpenLink={onOpenLink}
              />
            ) : (
              <MarkdownViewer
                key={index}
                content={segment.content}
                isStreaming={isStreaming}
                workspaceId={workspaceId}
                workspaceContext={workspaceContext}
                onCodeBlockAction={onCodeBlockAction}
                onFileClick={onFileClick}
                canOpenFile={canOpenFile}
                allowFileMedia={allowFileMedia}
                canLoadMedia={canLoadMedia}
                taskBlockRenderMode={taskBlockRenderMode}
                chatImageThumbnails={chatImageThumbnails}
                forceExternalLinks={forceExternalLinks}
                renderRichFencesAsCode={renderRichFencesAsCode}
                renderDiagrams={renderDiagrams}
                allowSanitizedHtml={allowSanitizedHtml}
                media={media}
                onOpenLink={onOpenLink}
                onOpenFile={onOpenFile}
                onOpenNote={onOpenNote}
              />
            ),
          )}
        </div>
      ) : !isStreaming && contentComplexity === 'simple' && !allowSanitizedHtml ? (
        <div className={`markdown-viewer simple-content react-markdown-viewer-scope ${className}`}>
          <p className="whitespace-pre-wrap react-markdown-viewer-scope">{markdownContent}</p>
        </div>
      ) : (
        <MarkdownViewerDom
          key={isStreaming ? 'streaming' : 'static'}
          className={`markdown-viewer ${isStreaming ? 'streaming-content' : 'static-content'} react-markdown-viewer-scope ${className}${chatImageThumbnails ? ' chat-image-thumbnails' : ''}`}
          html={processedContent}
          workspaceId={workspaceId}
          allowFileMedia={allowFileMedia}
          canLoadMedia={canLoadMedia}
          canOpenFile={canOpenFile}
          renderDiagrams={renderDiagrams}
          onOpenLink={onOpenLink}
          onOpenFile={onOpenFile}
          onElement={setContentElement}
          onMediaRemoved={(image) => {
            if (hoveredImage !== image) return;
            setHoveredImage(null);
            setImageActionsOpen(false);
          }}
          overlay={overlay}
        />
      )}
      {lightboxImageUrl && canUseMedia(lightboxImageUrl) ? (
        <ImageLightbox
          open={lightboxOpen}
          onOpenChange={setLightboxOpen}
          imageUrl={lightboxImageUrl}
          imageName={lightboxImageAlt}
          openerElement={lightboxOpenerElement}
          showActionsMenu
        />
      ) : null}
    </>
  );
}

export default MarkdownViewer;
