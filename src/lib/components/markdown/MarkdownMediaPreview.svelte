<script lang="ts">
  import ImageLightbox from '$lib/components/ui/ImageLightbox.svelte';
  import VideoLightbox from '$lib/components/ui/VideoLightbox.svelte';
  import {
    workspaceAssetImageSource,
    workspaceAssetVideoSource,
  } from '$lib/utils/workspace-file-image';

  interface Props {
    workspaceId?: string;
    canUseMedia: (url: string) => boolean;
  }
  interface Selection {
    url: string;
    name?: string;
    opener: HTMLElement;
    mimeType?: string;
    assetLink?: boolean;
  }
  let { workspaceId, canUseMedia }: Props = $props();
  let image = $state<Selection | null>(null);
  let video = $state<Selection | null>(null);
  let imageOpen = $state(false);
  let videoOpen = $state(false);

  export function openImage(element: HTMLImageElement) {
    image = {
      url: element.getAttribute('src') || '',
      name: element.getAttribute('alt') || undefined,
      opener: element,
    };
    imageOpen = true;
  }

  export function openAsset(anchor: HTMLAnchorElement): boolean {
    const source = workspaceAssetImageSource(anchor.getAttribute('href') || '', workspaceId);
    if (source && canUseMedia(source)) {
      image = {
        url: source,
        name: anchor.textContent?.trim() || undefined,
        opener: anchor,
        assetLink: true,
      };
      imageOpen = true;
      return true;
    }
    return openVideo(anchor);
  }

  function openVideo(anchor: HTMLAnchorElement): boolean {
    // Validate the raw href: URL normalization must not hide invalid paths/hints.
    const source = workspaceAssetVideoSource(anchor.getAttribute('href') || '', workspaceId);
    if (!source || !canUseMedia(source.url)) return false;
    video = {
      url: source.url,
      mimeType: source.mimeType,
      name: anchor.textContent?.trim() || undefined,
      opener: anchor,
    };
    videoOpen = true;
    return true;
  }

  $effect(() => {
    // A reused Markdown view must not retain another workspace's preview.
    if (video && !workspaceAssetVideoSource(video.url, workspaceId)) {
      videoOpen = false;
      video = null;
    }
    if (image?.assetLink && !workspaceAssetImageSource(image.url, workspaceId)) {
      imageOpen = false;
      image = null;
    }
  });
</script>

{#if image && canUseMedia(image.url)}
  <ImageLightbox
    bind:open={imageOpen}
    imageUrl={image.url}
    imageName={image.name}
    openerElement={image.opener}
    showActionsMenu
  />
{/if}

{#if video && workspaceAssetVideoSource(video.url, workspaceId) && canUseMedia(video.url)}
  <VideoLightbox
    bind:open={videoOpen}
    videoUrl={video.url}
    videoName={video.name}
    mimeType={video.mimeType}
    sourceKind="workspace"
    openerElement={video.opener}
  />
{/if}
