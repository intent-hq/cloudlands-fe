<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  type Scene =
    | 'gallery'
    | 'linked'
    | 'broken'
    | 'thumbnail-only'
    | 'truncated'
    | 'loading'
    | 'hydrated'
    | 'https'
    | 'download-failure'
    | 'clipboard-failure';
  interface Props {
    scene?: Scene;
  }

  export const preview = definePreview<Props>({
    id: 'image-sharing',
    title: 'Image sharing controls',
    defaultState: 'gallery',
    states: {
      gallery: { props: { scene: 'gallery' } },
      linked: { props: { scene: 'linked' } },
      broken: { props: { scene: 'broken' } },
      'thumbnail-only': { props: { scene: 'thumbnail-only' } },
      truncated: { props: { scene: 'truncated' } },
      loading: { props: { scene: 'loading' } },
      hydrated: { props: { scene: 'hydrated' } },
      https: { props: { scene: 'https' } },
      'download-failure': { props: { scene: 'download-failure' } },
      'clipboard-failure': { props: { scene: 'clipboard-failure' } },
    },
  });
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import MarkdownViewer from './MarkdownViewer.svelte';
  import ChatImageBlock from '$lib/components/chat/ChatImageBlock.svelte';
  import { Button } from '$lib/components/ui/button';
  import { ErrorState } from '$lib/components/patterns/screen';
  import {
    createImageSharingRaster,
    IMAGE_SHARING_HTTPS_URL,
    IMAGE_SHARING_LINK_URL,
    installImageSharingClipboardFailure,
    installImageSharingDownloadFailure,
    installImageSharingLinkCapture,
  } from './image-sharing.preview-fixtures';

  let { scene = 'gallery' }: Props = $props();
  let original = $state('');
  let thumbnail = $state('');
  let hydrated = $state(false);
  let loading = $state(false);
  let linkedDestination = $state('');
  let routedHttps = $state(false);
  const needsRoute = $derived(scene === 'https' || scene === 'download-failure');
  const hasOriginal = $derived(scene === 'hydrated' || hydrated);
  const showChat = $derived(['thumbnail-only', 'truncated', 'loading', 'hydrated'].includes(scene));
  const source = $derived(needsRoute ? IMAGE_SHARING_HTTPS_URL : original);

  const descriptions: Record<Scene, { title: string; detail: string }> = {
    gallery: {
      title: 'Images, without the guesswork',
      detail:
        'The same original is available in a note and a chat. Hover or focus to reveal its actions.',
    },
    linked: {
      title: 'A linked image stays a link',
      detail:
        'Activate the artwork to follow its link, or use the separate image menu. Navigation is intercepted locally.',
    },
    broken: {
      title: 'Missing pixels, clear feedback',
      detail:
        'Invalid image bytes produce the real unavailable state, not a broken browser icon or an export menu.',
    },
    'thumbnail-only': {
      title: 'A thumbnail is not an original',
      detail:
        'Only 160 × 100 pixels arrived with this message. Load the original before copying or downloading it.',
    },
    truncated: {
      title: 'No thumbnail was included',
      detail:
        'A slim message can omit all image bytes. The real placeholder requests the original on demand.',
    },
    loading: {
      title: 'The original is loading',
      detail: 'A held loading fixture. Finish the simulated load below; no daemon request is sent.',
    },
    hydrated: {
      title: 'The original is ready',
      detail:
        'The small chat tile now holds the full 960 × 600 image. Its menu and lightbox use the original bytes.',
    },
    https: {
      title: 'An HTTPS image, locally routed',
      detail:
        'A reserved HTTPS URL is fulfilled by the capture harness with fake artwork. Copy link remains available.',
    },
    'download-failure': {
      title: 'Visible image, unavailable download',
      detail:
        'The capture route loads the artwork; this isolated fixture rejects original-byte fetches with HTTP 403. Try Download.',
    },
    'clipboard-failure': {
      title: 'Clipboard permission denied',
      detail:
        'Try Copy image. A scoped clipboard seam rejects the real PNG write so the production error feedback appears.',
    },
  };
  const copy = $derived(descriptions[scene]);

  onMount(() => {
    original = createImageSharingRaster();
    thumbnail = createImageSharingRaster(true);
    routedHttps = Reflect.get(window, '__IMAGE_SHARING_PREVIEW_ROUTED__') === true;
    const disposers: Array<() => void> = [];
    if (scene === 'linked') {
      disposers.push(
        installImageSharingLinkCapture((url) => {
          linkedDestination = url;
        }),
      );
    }
    if (scene === 'download-failure') disposers.push(installImageSharingDownloadFailure());
    if (scene === 'clipboard-failure') disposers.push(installImageSharingClipboardFailure());
    return () => disposers.reverse().forEach((dispose) => dispose());
  });

  function requestOriginal() {
    loading = true;
  }
  function finishHydration() {
    hydrated = true;
    loading = false;
  }
</script>

<!-- i18n-ignore (development-only preview copy and synthetic artwork) -->
<section
  class="w-full bg-background p-6 text-foreground"
  data-testid="image-sharing-preview"
  data-scene={scene}
>
  <header class="mb-6 max-w-2xl space-y-2">
    <p class="type-caption text-muted-foreground">Content sharing / Image controls</p>
    <h1 class="type-display">{copy.title}</h1>
    <p class="type-body text-muted-foreground">{copy.detail}</p>
  </header>

  {#if needsRoute && !routedHttps}
    <ErrorState>
      {#snippet message()}
        Local HTTPS route required. Install the image-sharing.invalid capture route and set
        __IMAGE_SHARING_PREVIEW_ROUTED__ before loading this scene. No external request was made.
      {/snippet}
    </ErrorState>
  {:else if original}
    {#if scene === 'gallery'}
      <div class="grid gap-6 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <article class="min-w-0 space-y-3 rounded-xl border border-border bg-card p-5">
          <h2 class="type-title">In a note</h2>
          <MarkdownViewer content={`![Harbor study](${original})`} />
          <p class="type-caption text-muted-foreground">Embedded PNG · full original · 960 × 600</p>
        </article>
        <article class="min-w-0 space-y-3 rounded-xl border border-border bg-card p-5">
          <h2 class="type-title">In a chat</h2>
          <ChatImageBlock
            data={original.split(',')[1]}
            mimeType="image/png"
            alt="Harbor study.png"
          />
          <p class="type-caption text-muted-foreground">Compact tile. Original bytes.</p>
          <p class="type-caption text-muted-foreground">
            Open the lightbox for zoom, pan, and the same image actions.
          </p>
        </article>
      </div>
    {:else if showChat}
      <article
        class="space-y-4 rounded-xl border border-border bg-card p-5"
        data-testid="image-hydration-fixture"
      >
        <h2 class="type-title">Agent attachment</h2>
        <ChatImageBlock
          data={hasOriginal
            ? original.split(',')[1]
            : scene === 'truncated'
              ? undefined
              : thumbnail.split(',')[1]}
          mimeType="image/png"
          alt="Harbor study.png"
          dataTruncated={!hasOriginal}
          dataIsThumbnail={!hasOriginal && scene !== 'truncated'}
          hydrationLoading={!hasOriginal && (loading || scene === 'loading')}
          onHydrate={requestOriginal}
        />
        <p class="type-body text-muted-foreground" role="status">
          {hasOriginal
            ? 'Original loaded · 960 × 600. Click again to preview.'
            : loading || scene === 'loading'
              ? 'Waiting for the original. Thumbnail exports remain unavailable.'
              : 'Original not loaded. Click the image or placeholder to request it.'}
        </p>
        {#if !hasOriginal && (loading || scene === 'loading')}
          <Button variant="outline" size="sm" onclick={finishHydration}
            >Finish simulated load</Button
          >
        {/if}
      </article>
    {:else if scene === 'broken'}
      <div class="grid gap-6 sm:grid-cols-2">
        <article class="space-y-4 rounded-xl border border-border bg-card p-5">
          <h2 class="type-title">In a note</h2>
          <MarkdownViewer content="![Unavailable sketch](data:image/png;base64,bm90LWFuLWltYWdl)" />
        </article>
        <article class="space-y-4 rounded-xl border border-border bg-card p-5">
          <h2 class="type-title">In a chat</h2>
          <ChatImageBlock
            data="bm90LWFuLWltYWdl"
            mimeType="image/png"
            alt="Unavailable sketch.png"
          />
        </article>
      </div>
    {:else}
      <article class="max-w-2xl space-y-3 rounded-xl border border-border bg-card p-5">
        <MarkdownViewer
          content={scene === 'linked'
            ? `[![Read the field notes](${source})](${IMAGE_SHARING_LINK_URL})`
            : `![Harbor study](${source})`}
        />
        <p class="type-caption text-muted-foreground">
          {needsRoute ? IMAGE_SHARING_HTTPS_URL : 'Embedded PNG · full original · 960 × 600'}
        </p>
        {#if scene === 'linked'}
          <p class="type-body text-muted-foreground" role="status">
            {linkedDestination
              ? `Link requested: ${linkedDestination} (intercepted; no browser opened)`
              : 'Link destination: synthetic field notes. No real navigation.'}
          </p>
        {/if}
      </article>
    {/if}
  {/if}

  <footer
    class="mt-6 flex flex-wrap gap-x-6 gap-y-2 border-t border-border pt-4 type-caption text-muted-foreground"
  >
    <span>Tab to focus · Enter to preview · Arrow down for actions</span>
    <span>Escape closes the menu first, then the lightbox</span>
    <span>Fake assets only · Native Electron behavior not simulated</span>
  </footer>
</section>
