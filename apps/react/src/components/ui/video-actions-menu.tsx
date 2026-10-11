// Source: src/lib/components/ui/VideoActionsMenu.svelte.
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { notify } from '@/components/patterns/notify';
import * as Menu from '@/components/ui/menu';
import { cn } from '@/lib/utils';
import { writeTextToClipboard } from '@/lib/clipboard';
import type { VideoSource } from '$shared/types/video-source';
import { m } from '$shared/paraglide/messages.js';
import { getLocale } from '$shared/paraglide/runtime.js';
import { createFormatters } from '$shared/i18n/formatters';
import { pushEscapeLayer } from '$lib/utils/escapeLayers';
import {
  base64ByteSize,
  parseBase64DataUrl,
  parseWorkspaceFileImageUrl,
} from '$lib/utils/image-actions';

const { formatBytesBinary, formatCompactDuration, formatInteger } = createFormatters(getLocale);

export interface VideoActionsMenuProps {
  videoUrl: string;
  videoName?: string;
  sourceKind?: VideoSource['kind'];
  mimeType?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  triggerClass?: string;
  contentClass?: string;
}

export function VideoActionsMenu({
  videoUrl,
  videoName,
  sourceKind,
  mimeType,
  open = false,
  onOpenChange,
  triggerClass,
  contentClass,
}: VideoActionsMenuProps) {
  const [visibility, setVisibility] = useState({ prop: open, open });
  if (visibility.prop !== open) setVisibility({ prop: open, open });
  const menuOpen = visibility.prop !== open ? open : visibility.open;
  function setOpen(value: boolean) {
    setVisibility({ prop: open, open: value });
    onOpenChange?.(value);
  }
  const dataUrl = parseBase64DataUrl(videoUrl);
  const workspaceFile = parseWorkspaceFileImageUrl(videoUrl);
  const resolvedKind = sourceKind ?? (dataUrl ? 'inline' : workspaceFile ? 'workspace' : 'remote');
  const [durationSeconds, setDurationSeconds] = useState<number | null>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [byteSize, setByteSize] = useState<number | null>(null);
  const infoLoadedFor = useRef<string | null>(null);
  const releaseInfo = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      infoLoadedFor.current = null;
      releaseInfo.current?.();
      releaseInfo.current = null;
    },
    [videoUrl],
  );
  useEffect(() => {
    if (!menuOpen || infoLoadedFor.current === videoUrl) return;
    const loadedFor = (infoLoadedFor.current = videoUrl);
    setDurationSeconds(null);
    setDimensions(null);
    const data = parseBase64DataUrl(videoUrl);
    setByteSize(data ? base64ByteSize(data.base64) : null);
    const probe = document.createElement('video');
    const controller = new AbortController();
    probe.preload = 'metadata';
    probe.onloadedmetadata = () => {
      if (infoLoadedFor.current !== loadedFor || controller.signal.aborted) return;
      if (Number.isFinite(probe.duration) && probe.duration > 0) setDurationSeconds(probe.duration);
      if (probe.videoWidth > 0 && probe.videoHeight > 0) {
        setDimensions({ width: probe.videoWidth, height: probe.videoHeight });
      }
    };
    probe.src = videoUrl;
    releaseInfo.current = () => {
      probe.onloadedmetadata = null;
      probe.removeAttribute('src');
      probe.load();
      controller.abort();
    };
    if (!data) {
      void fetch(videoUrl, { signal: controller.signal })
        .then((response) => (response.ok ? response.blob() : null))
        .then((blob) => {
          if (blob && infoLoadedFor.current === loadedFor && !controller.signal.aborted)
            setByteSize(blob.size);
        })
        .catch(() => {});
    }
  }, [videoUrl, menuOpen]);
  const closeMenu = useEffectEvent(() => setOpen(false));
  useEffect(() => {
    if (menuOpen) return pushEscapeLayer(() => closeMenu());
  }, [menuOpen]);

  function downloadFileName(): string {
    const workspaceName = workspaceFile?.path.split('/').pop();
    if (workspaceName) return workspaceName;
    const base = (videoName || 'video').replace(/[/\\]/g, '_'); // i18n-ignore (file name fallback)
    if (/\.[A-Za-z0-9]+$/.test(base)) return base;
    const extension = (mimeType ?? dataUrl?.mimeType) === 'video/webm' ? 'webm' : 'mp4';
    return `${base}.${extension}`;
  }

  async function download() {
    let objectUrl: string | null = null;
    try {
      let href = videoUrl;
      if (!dataUrl) {
        const response = await fetch(videoUrl);
        if (!response.ok) throw new Error(`Video fetch failed: ${response.status}`);
        objectUrl = URL.createObjectURL(await response.blob());
        href = objectUrl;
      }
      const link = document.createElement('a');
      link.href = href;
      link.download = downloadFileName();
      document.body.appendChild(link);
      try {
        link.click();
      } finally {
        link.remove();
      }
    } catch {
      notify.error(m.ui_videoActionsMenu_downloadFailed_error());
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
  }

  async function copy(value: string, successMessage: string) {
    try {
      await writeTextToClipboard(value);
      notify.success(successMessage);
    } catch {
      notify.error(m.ui_videoActionsMenu_copyFailed_error());
    }
  }

  return (
    <Menu.Root open={menuOpen} onOpenChange={setOpen}>
      <Menu.Trigger
        className={cn(
          'flex h-7 w-7 items-center justify-center rounded-md bg-black/60 text-white',
          'hover:bg-black/75',
          triggerClass,
        )}
        aria-label={m.ui_videoActionsMenu_trigger_ariaLabel()}
        onClick={(event) => event.stopPropagation()}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          fill="currentColor"
          className="size-3.5"
          aria-hidden="true"
        >
          <path d="M8 2a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM8 6.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM9.5 12.5a1.5 1.5 0 1 0-3 0 1.5 1.5 0 0 0 3 0Z" />
        </svg>
      </Menu.Trigger>
      <Menu.Content className={contentClass} align="end">
        <Menu.Item onSelect={() => void download()}>
          {m.ui_videoActionsMenu_download_label()}
        </Menu.Item>
        {resolvedKind === 'workspace' && workspaceFile ? (
          <Menu.Item
            onSelect={() => void copy(workspaceFile.path, m.ui_videoActionsMenu_pathCopied_label())}
          >
            {m.ui_videoActionsMenu_copyPath_label()}
          </Menu.Item>
        ) : resolvedKind === 'remote' ? (
          <Menu.Item onSelect={() => void copy(videoUrl, m.ui_videoActionsMenu_linkCopied_label())}>
            {m.ui_videoActionsMenu_copyLink_label()}
          </Menu.Item>
        ) : null}
        {(durationSeconds !== null || dimensions || byteSize !== null) && (
          <>
            <Menu.Separator />
            {durationSeconds !== null && (
              <div
                className="type-caption px-2 py-1 text-muted-foreground"
                data-testid="video-info-duration"
              >
                {m.ui_videoActionsMenu_duration_label({
                  duration: formatCompactDuration(durationSeconds * 1000),
                })}
              </div>
            )}
            {dimensions && (
              <div
                className="type-caption px-2 py-1 text-muted-foreground"
                data-testid="video-info-dimensions"
              >
                {m.ui_videoActionsMenu_dimensions_label({
                  width: formatInteger(dimensions.width),
                  height: formatInteger(dimensions.height),
                })}
              </div>
            )}
            {byteSize !== null && (
              <div
                className="type-caption px-2 py-1 text-muted-foreground"
                data-testid="video-info-size"
              >
                {formatBytesBinary(byteSize)}
              </div>
            )}
          </>
        )}
      </Menu.Content>
    </Menu.Root>
  );
}

export default VideoActionsMenu;
