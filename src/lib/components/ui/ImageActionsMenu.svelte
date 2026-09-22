<script lang="ts">
  /**
   * ImageActionsMenu — ellipsis menu for a chat image (thumbnail or lightbox).
   *
   * Offers Download plus Copy path (workspace-file images) or Copy image
   * (inline base64 images), and non-interactive info rows with the image's
   * dimensions and byte size. While open it registers an escape layer so a
   * hosting overlay (e.g. the image lightbox) is not dismissed by the same
   * Escape that closes the menu.
   */
  import Fa from 'svelte-fa';
  import { faEllipsis } from '@fortawesome/free-solid-svg-icons';
  import { notify } from '$lib/components/patterns/notify';
  import { Button } from '$lib/components/ui/button';
  import * as Menu from '$lib/components/ui/menu';
  import { cn } from '$lib/utils.js';
  import { m } from '$shared/paraglide/messages.js';
  import { writeTextToClipboard } from '$lib/utils/clipboard';
  import { formatBytesBinary, formatInteger } from '$lib/i18n/format';
  import { pushEscapeLayer } from '$lib/utils/escapeLayers';
  import {
    base64ByteSize,
    base64ToBlob,
    imageDownloadFileName,
    isHttpsImageUrl,
    parseBase64DataUrl,
    parseWorkspaceFileImageUrl,
    supportsImageActions,
  } from '$lib/utils/image-actions';

  interface Props {
    /** Image source: data, workspace-file, workspace-asset, or HTTPS URL. */
    imageUrl: string;
    /** Display name — download filename fallback for data-URL images. */
    imageName?: string;
    open?: boolean;
    /** Extra classes for the trigger button (positioning/visibility). */
    triggerClass?: string;
    /** Extra classes for the popover (e.g. z-index override in the lightbox). */
    contentClass?: string;
  }

  let {
    imageUrl,
    imageName,
    open = $bindable(false),
    triggerClass,
    contentClass,
  }: Props = $props();

  const dataUrl = $derived(parseBase64DataUrl(imageUrl));
  const workspaceFile = $derived(parseWorkspaceFileImageUrl(imageUrl));
  const isHttpsImage = $derived(isHttpsImageUrl(imageUrl));

  // Info rows: dimensions from the decoded image, size from the byte payload.
  let dimensions = $state<{ width: number; height: number } | null>(null);
  let byteSize = $state<number | null>(null);
  let infoLoadedFor: string | null = null;

  function loadInfo() {
    if (infoLoadedFor === imageUrl) return;
    // Captured against the URL this load started with: callbacks resolving
    // after the URL changed (e.g. hydration swapped in the full image and a
    // fresh load started) must not overwrite the newer image's info.
    const loadedFor = (infoLoadedFor = imageUrl);
    dimensions = null;
    byteSize = dataUrl ? base64ByteSize(dataUrl.base64) : null;

    const probe = new Image();
    probe.onload = () => {
      if (infoLoadedFor !== loadedFor) return;
      dimensions = { width: probe.naturalWidth, height: probe.naturalHeight };
    };
    probe.src = imageUrl;

    if (!dataUrl) {
      // eslint-disable-next-line intent/no-component-async-data-fetch -- reads the already-rendered image's bytes for the info row, not domain data
      void fetch(imageUrl)
        .then((response) => (response.ok ? response.blob() : null))
        .then((blob) => {
          if (blob && infoLoadedFor === loadedFor) byteSize = blob.size;
        })
        .catch(() => {
          // Size row simply stays hidden when the bytes cannot be fetched.
        });
    }
  }

  $effect(() => {
    if (open) loadInfo();
  });

  // Escape layer while open: the topmost layer wins, so Escape closes the
  // menu without also dismissing a hosting lightbox.
  $effect(() => {
    if (!open) return;
    return pushEscapeLayer(() => {
      open = false;
    });
  });

  async function getImageBlob(source = imageUrl): Promise<Blob> {
    const data = parseBase64DataUrl(source);
    if (data) return base64ToBlob(data.base64, data.mimeType);
    // eslint-disable-next-line intent/no-component-async-data-fetch -- reads the already-rendered image's bytes for a local download/copy action, not domain data
    const response = await fetch(source);
    if (!response.ok) throw new Error(`Image fetch failed: ${response.status}`);
    return await response.blob();
  }

  async function download() {
    let objectUrl: string | null = null;
    try {
      let href = imageUrl;
      let mimeType = dataUrl?.mimeType;
      if (!dataUrl) {
        // eslint-disable-next-line intent/no-component-async-data-fetch -- local blob read feeding the browser download, not domain data
        const blob = await getImageBlob();
        mimeType = blob.type;
        objectUrl = URL.createObjectURL(blob);
        href = objectUrl;
      }
      const link = document.createElement('a');
      link.href = href;
      link.download = imageDownloadFileName({
        workspacePath: workspaceFile?.path,
        imageName,
        mimeType,
      });
      document.body.appendChild(link);
      try {
        link.click();
      } finally {
        link.remove();
      }
    } catch {
      notify.error(m.ui_imageActionsMenu_downloadFailed_error());
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
  }

  async function copyPath() {
    if (!workspaceFile) return;
    try {
      await writeTextToClipboard(workspaceFile.path);
      notify.success(m.ui_imageActionsMenu_pathCopied_label());
    } catch {
      notify.error(m.ui_imageActionsMenu_copyFailed_error());
    }
  }

  async function copyLink() {
    if (!isHttpsImage) return;
    try {
      await writeTextToClipboard(imageUrl);
      notify.success(m.ui_imageActionsMenu_linkCopied_label());
    } catch {
      notify.error(m.ui_imageActionsMenu_copyFailed_error());
    }
  }

  async function convertToPngBlob(blob: Blob): Promise<Blob> {
    let bitmap: ImageBitmap | undefined;
    let objectUrl: string | undefined;
    try {
      let image: ImageBitmap | HTMLImageElement;
      if (blob.type.split(';')[0].trim() === 'image/svg+xml') {
        // Chromium cannot decode SVG Blobs with createImageBitmap directly.
        objectUrl = URL.createObjectURL(blob);
        const element = new Image();
        element.src = objectUrl;
        await element.decode();
        image = element;
      } else {
        image = bitmap = await createImageBitmap(blob);
      }
      const canvas = document.createElement('canvas');
      canvas.width = image instanceof HTMLImageElement ? image.naturalWidth : image.width;
      canvas.height = image instanceof HTMLImageElement ? image.naturalHeight : image.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('2d canvas context unavailable');
      context.drawImage(image, 0, 0);
      return await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (result) => (result ? resolve(result) : reject(new Error('canvas toBlob failed'))),
          'image/png',
        );
      });
    } finally {
      bitmap?.close();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
  }

  async function copyImage(source = imageUrl) {
    try {
      // eslint-disable-next-line intent/no-component-async-data-fetch -- local blob read feeding the clipboard write, not domain data
      let blob = await getImageBlob(source);
      // Clipboard image writes only accept PNG.
      if (blob.type !== 'image/png') blob = await convertToPngBlob(blob);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      notify.success(m.ui_imageActionsMenu_imageCopied_label());
    } catch {
      notify.error(m.ui_imageActionsMenu_copyFailed_error());
    }
  }

  /** Hosts forward only image-scoped events; portals handle their own events below. */
  export function handleCopy(event: KeyboardEvent | ClipboardEvent, source = imageUrl): boolean {
    if (event.defaultPrevented || !supportsImageActions(source)) return false;
    if (
      event instanceof KeyboardEvent &&
      (event.key.toLowerCase() !== 'c' ||
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.shiftKey ||
        event.isComposing)
    )
      return false;
    const target = event.target;
    if (
      (target instanceof Element &&
        (target.closest(
          'input, textarea, select, [role="textbox"], [contenteditable]:not([contenteditable="false"])',
        ) ||
          (target instanceof HTMLElement && target.isContentEditable))) ||
      document.getSelection()?.toString()
    )
      return false;

    event.preventDefault();
    event.stopPropagation();
    if (event instanceof KeyboardEvent && event.repeat) return true;
    void copyImage(source);
    open = false;
    return true;
  }
</script>

{#if supportsImageActions(imageUrl)}
  <Menu.Root bind:open>
    <Menu.Trigger
      class={cn(
        'flex h-7 w-7 items-center justify-center rounded-md bg-black/60 text-white',
        'hover:bg-black/75',
        triggerClass,
      )}
      onclick={(event: MouseEvent) => event.stopPropagation()}
      onkeydown={(event) => handleCopy(event)}
      oncopy={(event) => handleCopy(event)}
    >
      {#snippet child({ props })}
        <Button
          {...props}
          variant="plain"
          size="icon-sm"
          wrapContent={false}
          active={open}
          aria-label={m.ui_imageActionsMenu_trigger_ariaLabel()}
        >
          <Fa icon={faEllipsis} size="sm" />
        </Button>
      {/snippet}
    </Menu.Trigger>
    <Menu.Content
      class={contentClass}
      align="end"
      onkeydown={(event) => handleCopy(event)}
      oncopy={(event) => handleCopy(event)}
    >
      <Menu.Item onSelect={() => void download()}>
        {m.ui_imageActionsMenu_download_label()}
      </Menu.Item>
      <Menu.Item onSelect={() => void copyImage()}>
        {m.ui_imageActionsMenu_copyImage_label()}
      </Menu.Item>
      {#if workspaceFile}
        <Menu.Item onSelect={() => void copyPath()}>
          {m.ui_imageActionsMenu_copyPath_label()}
        </Menu.Item>
      {:else if isHttpsImage}
        <Menu.Item onSelect={() => void copyLink()}>
          {m.ui_imageActionsMenu_copyLink_label()}
        </Menu.Item>
      {/if}
      {#if dimensions || byteSize !== null}
        <Menu.Separator />
        {#if dimensions}
          <div
            class="type-caption px-2 py-1 text-muted-foreground"
            data-testid="image-info-dimensions"
          >
            {m.ui_imageActionsMenu_dimensions_label({
              width: formatInteger(dimensions.width),
              height: formatInteger(dimensions.height),
            })}
          </div>
        {/if}
        {#if byteSize !== null}
          <div class="type-caption px-2 py-1 text-muted-foreground" data-testid="image-info-size">
            {formatBytesBinary(byteSize)}
          </div>
        {/if}
      {/if}
    </Menu.Content>
  </Menu.Root>
{/if}
