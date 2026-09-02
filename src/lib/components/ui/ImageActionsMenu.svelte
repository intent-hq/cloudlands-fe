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
  import { toast } from 'svelte-sonner';
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

  async function getImageBlob(): Promise<Blob> {
    if (dataUrl) return base64ToBlob(dataUrl.base64, dataUrl.mimeType);
    // eslint-disable-next-line intent/no-component-async-data-fetch -- reads the already-rendered image's bytes for a local download/copy action, not domain data
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error(`Image fetch failed: ${response.status}`);
    return await response.blob();
  }

  async function download() {
    try {
      let href = imageUrl;
      let objectUrl: string | null = null;
      if (!dataUrl) {
        // eslint-disable-next-line intent/no-component-async-data-fetch -- local blob read feeding the browser download, not domain data
        objectUrl = URL.createObjectURL(await getImageBlob());
        href = objectUrl;
      }
      const link = document.createElement('a');
      link.href = href;
      link.download = imageDownloadFileName({
        workspacePath: workspaceFile?.path,
        imageName,
        mimeType: dataUrl?.mimeType,
      });
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    } catch {
      toast.error(m.ui_imageActionsMenu_downloadFailed_error());
    }
  }

  async function copyPath() {
    if (!workspaceFile) return;
    try {
      await writeTextToClipboard(workspaceFile.path);
      toast.success(m.ui_imageActionsMenu_pathCopied_label());
    } catch {
      toast.error(m.ui_imageActionsMenu_copyFailed_error());
    }
  }

  async function copyLink() {
    if (!isHttpsImage) return;
    try {
      await writeTextToClipboard(imageUrl);
      toast.success(m.ui_imageActionsMenu_linkCopied_label());
    } catch {
      toast.error(m.ui_imageActionsMenu_copyFailed_error());
    }
  }

  async function convertToPngBlob(blob: Blob): Promise<Blob> {
    const bitmap = await createImageBitmap(blob);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('2d canvas context unavailable');
      context.drawImage(bitmap, 0, 0);
      return await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (result) => (result ? resolve(result) : reject(new Error('canvas toBlob failed'))),
          'image/png',
        );
      });
    } finally {
      bitmap.close();
    }
  }

  async function copyImage() {
    try {
      // eslint-disable-next-line intent/no-component-async-data-fetch -- local blob read feeding the clipboard write, not domain data
      let blob = await getImageBlob();
      // Clipboard image writes only accept PNG.
      if (blob.type !== 'image/png') blob = await convertToPngBlob(blob);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast.success(m.ui_imageActionsMenu_imageCopied_label());
    } catch {
      toast.error(m.ui_imageActionsMenu_copyFailed_error());
    }
  }
</script>

<Menu.Root bind:open>
  <Menu.Trigger
    class={cn(
      'flex h-7 w-7 items-center justify-center rounded-md bg-black/60 text-white',
      'hover:bg-black/75 focus-visible:ring-2 focus-visible:ring-ring',
      triggerClass,
    )}
    aria-label={m.ui_imageActionsMenu_trigger_ariaLabel()}
    onclick={(event: MouseEvent) => event.stopPropagation()}
  >
    <Fa icon={faEllipsis} size="sm" />
  </Menu.Trigger>
  <Menu.Content class={contentClass} align="end">
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
