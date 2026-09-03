<script lang="ts">
  import { faEllipsis } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { toast } from 'svelte-sonner';
  import type { VideoSource } from '$shared/types';
  import { m } from '$shared/paraglide/messages.js';
  import * as Menu from '$lib/components/ui/menu';
  import { formatBytesBinary, formatCompactDuration, formatInteger } from '$lib/i18n/format';
  import { cn } from '$lib/utils.js';
  import { writeTextToClipboard } from '$lib/utils/clipboard';
  import { pushEscapeLayer } from '$lib/utils/escapeLayers';
  import {
    base64ByteSize,
    parseBase64DataUrl,
    parseWorkspaceFileImageUrl,
  } from '$lib/utils/image-actions';

  interface Props {
    videoUrl: string;
    videoName?: string;
    sourceKind?: VideoSource['kind'];
    mimeType?: string;
    open?: boolean;
    triggerClass?: string;
    contentClass?: string;
  }

  let {
    videoUrl,
    videoName,
    sourceKind,
    mimeType,
    open = $bindable(false),
    triggerClass,
    contentClass,
  }: Props = $props();

  const dataUrl = $derived(parseBase64DataUrl(videoUrl));
  const workspaceFile = $derived(parseWorkspaceFileImageUrl(videoUrl));
  const resolvedKind = $derived(
    sourceKind ?? (dataUrl ? 'inline' : workspaceFile ? 'workspace' : 'remote'),
  );

  let durationSeconds = $state<number | null>(null);
  let dimensions = $state<{ width: number; height: number } | null>(null);
  let byteSize = $state<number | null>(null);
  let infoLoadedFor: string | null = null;

  function loadInfo() {
    if (infoLoadedFor === videoUrl) return;
    const loadedFor = (infoLoadedFor = videoUrl);
    durationSeconds = null;
    dimensions = null;
    byteSize = dataUrl ? base64ByteSize(dataUrl.base64) : null;

    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.onloadedmetadata = () => {
      if (infoLoadedFor !== loadedFor) return;
      if (Number.isFinite(probe.duration) && probe.duration > 0) durationSeconds = probe.duration;
      if (probe.videoWidth > 0 && probe.videoHeight > 0) {
        dimensions = { width: probe.videoWidth, height: probe.videoHeight };
      }
    };
    probe.src = videoUrl;

    if (!dataUrl) {
      // eslint-disable-next-line intent/no-component-async-data-fetch -- reads rendered media bytes for its info row
      void fetch(videoUrl)
        .then((response) => (response.ok ? response.blob() : null))
        .then((blob) => {
          if (blob && infoLoadedFor === loadedFor) byteSize = blob.size;
        })
        .catch(() => {});
    }
  }

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
        // eslint-disable-next-line intent/no-component-async-data-fetch -- reads rendered media bytes for a browser download
        const response = await fetch(videoUrl);
        if (!response.ok) throw new Error(`Video fetch failed: ${response.status}`);
        objectUrl = URL.createObjectURL(await response.blob());
        href = objectUrl;
      }
      const link = document.createElement('a');
      link.href = href;
      link.download = downloadFileName();
      document.body.appendChild(link);
      link.click();
      link.remove();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    } catch {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      toast.error(m.ui_videoActionsMenu_downloadFailed_error());
    }
  }

  async function copy(value: string, successMessage: string) {
    try {
      await writeTextToClipboard(value);
      toast.success(successMessage);
    } catch {
      toast.error(m.ui_videoActionsMenu_copyFailed_error());
    }
  }

  $effect(() => {
    if (open) loadInfo();
  });

  $effect(() => {
    if (!open) return;
    return pushEscapeLayer(() => {
      open = false;
    });
  });
</script>

<Menu.Root bind:open>
  <Menu.Trigger
    class={cn(
      'flex h-7 w-7 items-center justify-center rounded-md bg-black/60 text-white',
      'hover:bg-black/75 focus-visible:ring-2 focus-visible:ring-ring',
      triggerClass,
    )}
    aria-label={m.ui_videoActionsMenu_trigger_ariaLabel()}
    onclick={(event: MouseEvent) => event.stopPropagation()}
  >
    <Fa icon={faEllipsis} size="sm" />
  </Menu.Trigger>
  <Menu.Content class={contentClass} align="end">
    <Menu.Item onSelect={() => void download()}>
      {m.ui_videoActionsMenu_download_label()}
    </Menu.Item>
    {#if resolvedKind === 'workspace' && workspaceFile}
      <Menu.Item
        onSelect={() => void copy(workspaceFile.path, m.ui_videoActionsMenu_pathCopied_label())}
      >
        {m.ui_videoActionsMenu_copyPath_label()}
      </Menu.Item>
    {:else if resolvedKind === 'remote'}
      <Menu.Item onSelect={() => void copy(videoUrl, m.ui_videoActionsMenu_linkCopied_label())}>
        {m.ui_videoActionsMenu_copyLink_label()}
      </Menu.Item>
    {/if}
    {#if durationSeconds !== null || dimensions || byteSize !== null}
      <Menu.Separator />
      {#if durationSeconds !== null}
        <div class="type-caption px-2 py-1 text-muted-foreground" data-testid="video-info-duration">
          {m.ui_videoActionsMenu_duration_label({
            duration: formatCompactDuration(durationSeconds * 1000),
          })}
        </div>
      {/if}
      {#if dimensions}
        <div
          class="type-caption px-2 py-1 text-muted-foreground"
          data-testid="video-info-dimensions"
        >
          {m.ui_videoActionsMenu_dimensions_label({
            width: formatInteger(dimensions.width),
            height: formatInteger(dimensions.height),
          })}
        </div>
      {/if}
      {#if byteSize !== null}
        <div class="type-caption px-2 py-1 text-muted-foreground" data-testid="video-info-size">
          {formatBytesBinary(byteSize)}
        </div>
      {/if}
    {/if}
  </Menu.Content>
</Menu.Root>
