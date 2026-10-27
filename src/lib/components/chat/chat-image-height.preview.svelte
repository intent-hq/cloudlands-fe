<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  interface Props {
    landscape?: boolean;
    unsized?: boolean;
    isStreaming?: boolean;
  }

  export const preview = definePreview<Props>({
    id: 'chat-image-height',
    title: 'Chat image height',
    defaultState: 'portrait',
    states: {
      portrait: { props: {} },
      landscape: { props: { landscape: true } },
      unsized: { props: { unsized: true } },
      streaming: { props: { isStreaming: true } },
    },
  });
</script>

<script lang="ts">
  import MarkdownViewer from '$lib/components/markdown/MarkdownViewer.svelte';
  import { IMAGE_SHARING_SVG } from '$lib/components/markdown/image-sharing.preview-fixtures';
  import ChatImageBlock from './ChatImageBlock.svelte';

  let { landscape = false, unsized = false, isStreaming = false }: Props = $props();
  const width = $derived(landscape ? 960 : 600);
  const height = $derived(landscape ? 600 : 1200);
  const source = $derived(
    `data:image/svg+xml,${encodeURIComponent(
      IMAGE_SHARING_SVG.replace(
        'width="960" height="600"',
        `width="${width}" height="${height}"`,
      ).replace(
        'viewBox="0 0 960 600"',
        `viewBox="${landscape ? '0 0 960 600' : '450 0 300 600'}"`,
      ),
    )}`,
  );
</script>

<!-- i18n-ignore (development-only preview copy and synthetic artwork) -->
<section class="w-full space-y-6 bg-background p-6 text-foreground">
  <h1 class="type-title">Chat image height</h1>
  <div class="grid gap-6 sm:grid-cols-2">
    <article class="min-w-0 space-y-3">
      <h2 class="type-body font-medium">Markdown image</h2>
      <MarkdownViewer
        content={`![Harbor study](${source})`}
        chatImageThumbnails
        {isStreaming}
        media={unsized ? undefined : { [source]: { width, height } }}
      />
    </article>
    <article class="min-w-0 space-y-3">
      <h2 class="type-body font-medium">Image block</h2>
      <ChatImageBlock
        src={source}
        mimeType="image/svg+xml"
        alt="Harbor study"
        width={unsized ? undefined : width}
        height={unsized ? undefined : height}
      />
      <h2 class="type-body font-medium">Image file</h2>
      <ChatImageBlock src={source} mimeType="image/svg+xml" alt="Harbor study.svg" variant="file" />
    </article>
  </div>
</section>
