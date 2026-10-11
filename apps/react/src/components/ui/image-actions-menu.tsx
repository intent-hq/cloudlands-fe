// Source: src/lib/components/ui/ImageActionsMenu.svelte.
import {
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
  type SyntheticEvent,
} from 'react';
import { notify } from '@/components/patterns/notify';
import { Button } from '@/components/ui/button';
import * as Menu from '@/components/ui/menu';
import { cn } from '@/lib/utils';
import { writeTextToClipboard } from '@/lib/clipboard';
import { m } from '$shared/paraglide/messages.js';
import { getLocale } from '$shared/paraglide/runtime.js';
import { createFormatters } from '$shared/i18n/formatters';
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

const { formatBytesBinary, formatInteger } = createFormatters(getLocale);

export interface ImageActionsMenuHandle {
  handleCopy: (event: KeyboardEvent | ClipboardEvent, source?: string) => boolean;
}
export interface ImageActionsMenuProps {
  imageUrl: string;
  imageName?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  triggerClass?: string;
  contentClass?: string;
  ref?: Ref<ImageActionsMenuHandle>;
}

export function ImageActionsMenu({
  imageUrl,
  imageName,
  open = false,
  onOpenChange,
  triggerClass,
  contentClass,
  ref,
}: ImageActionsMenuProps) {
  // Svelte bindable props remain locally writable without a parent binding.
  const [visibility, setVisibility] = useState({ prop: open, open });
  if (visibility.prop !== open) setVisibility({ prop: open, open });
  const menuOpen = visibility.prop !== open ? open : visibility.open;
  function setOpen(value: boolean) {
    setVisibility({ prop: open, open: value });
    onOpenChange?.(value);
  }
  const dataUrl = parseBase64DataUrl(imageUrl);
  const workspaceFile = parseWorkspaceFileImageUrl(imageUrl);
  const isHttpsImage = isHttpsImageUrl(imageUrl);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [byteSize, setByteSize] = useState<number | null>(null);
  const infoLoadedFor = useRef<string | null>(null);
  const releaseInfo = useRef<(() => void) | null>(null);

  // Keep pending work alive across menu dismissal, but release it on URL replacement/unmount.
  useEffect(
    () => () => {
      infoLoadedFor.current = null;
      releaseInfo.current?.();
      releaseInfo.current = null;
    },
    [imageUrl],
  );
  useEffect(() => {
    if (!menuOpen || infoLoadedFor.current === imageUrl) return;
    const loadedFor = (infoLoadedFor.current = imageUrl);
    setDimensions(null);
    const data = parseBase64DataUrl(imageUrl);
    setByteSize(data ? base64ByteSize(data.base64) : null);
    const probe = new Image();
    const controller = new AbortController();
    probe.onload = () => {
      if (infoLoadedFor.current === loadedFor && !controller.signal.aborted) {
        setDimensions({ width: probe.naturalWidth, height: probe.naturalHeight });
      }
    };
    probe.src = imageUrl;
    releaseInfo.current = () => {
      probe.onload = null;
      probe.removeAttribute('src');
      controller.abort();
    };
    if (!data) {
      void fetch(imageUrl, { signal: controller.signal })
        .then((response) => (response.ok ? response.blob() : null))
        .then((blob) => {
          if (blob && infoLoadedFor.current === loadedFor && !controller.signal.aborted)
            setByteSize(blob.size);
        })
        .catch(() => {});
    }
  }, [imageUrl, menuOpen]);
  const closeMenu = useEffectEvent(() => setOpen(false));
  useEffect(() => {
    if (menuOpen) return pushEscapeLayer(() => closeMenu());
  }, [menuOpen]);
  async function getImageBlob(source = imageUrl): Promise<Blob> {
    const data = parseBase64DataUrl(source);
    if (data) return base64ToBlob(data.base64, data.mimeType);
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
  function handleCopy(event: KeyboardEvent | ClipboardEvent, source = imageUrl): boolean {
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
    setOpen(false);
    return true;
  }
  useImperativeHandle(ref, () => ({ handleCopy }));
  function handlePortalCopy(event: SyntheticEvent<HTMLElement, KeyboardEvent | ClipboardEvent>) {
    if (handleCopy(event.nativeEvent)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  if (!supportsImageActions(imageUrl)) return null;
  return (
    <Menu.Root open={menuOpen} onOpenChange={setOpen}>
      <Menu.Trigger
        asChild
        className={cn(
          'flex h-7 w-7 items-center justify-center rounded-md bg-black/60 text-white',
          'hover:bg-black/75',
          triggerClass,
        )}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handlePortalCopy}
        onCopy={handlePortalCopy}
      >
        <Button
          variant="plain"
          size="icon-sm"
          wrapContent={false}
          active={menuOpen}
          aria-label={m.ui_imageActionsMenu_trigger_ariaLabel()}
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
        </Button>
      </Menu.Trigger>
      <Menu.Content
        className={contentClass}
        align="end"
        onKeyDown={handlePortalCopy}
        onCopy={handlePortalCopy}
      >
        <Menu.Item onSelect={() => void download()}>
          {m.ui_imageActionsMenu_download_label()}
        </Menu.Item>
        <Menu.Item onSelect={() => void copyImage()}>
          {m.ui_imageActionsMenu_copyImage_label()}
        </Menu.Item>
        {workspaceFile ? (
          <Menu.Item onSelect={() => void copyPath()}>
            {m.ui_imageActionsMenu_copyPath_label()}
          </Menu.Item>
        ) : isHttpsImage ? (
          <Menu.Item onSelect={() => void copyLink()}>
            {m.ui_imageActionsMenu_copyLink_label()}
          </Menu.Item>
        ) : null}
        {(dimensions || byteSize !== null) && (
          <>
            <Menu.Separator />
            {dimensions && (
              <div
                className="type-caption px-2 py-1 text-muted-foreground"
                data-testid="image-info-dimensions"
              >
                {m.ui_imageActionsMenu_dimensions_label({
                  width: formatInteger(dimensions.width),
                  height: formatInteger(dimensions.height),
                })}
              </div>
            )}
            {byteSize !== null && (
              <div
                className="type-caption px-2 py-1 text-muted-foreground"
                data-testid="image-info-size"
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

export default ImageActionsMenu;
