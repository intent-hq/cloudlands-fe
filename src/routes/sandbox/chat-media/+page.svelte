<script lang="ts">
  import { page } from '$app/state';
  import MarkdownViewer from '$lib/components/markdown/MarkdownViewer.svelte';
  import MediaLoadingPlaceholder from '$lib/components/ui/MediaLoadingPlaceholder.svelte';
  import MediaUnavailable from '$lib/components/ui/MediaUnavailable.svelte';

  let retryCount = $state(0);
  const workspaceId = $derived(page.url.searchParams.get('workspace') || undefined);
  const longName = 'architecture-review-with-a-very-long-unbroken-filename-for-narrow-layouts.png';
  const markdown = [
    '### Architecture preview',
    'The media state should stay quiet between ordinary chat paragraphs.',
    '![Architecture preview](data:image/png;base64,invalid)',
    'The conversation continues here without a large error card.',
  ].join('\n\n');
</script>

<svelte:head>
  <title>Chat media states</title>
</svelte:head>

<article class="grid w-[min(720px,100vw)] min-w-0 gap-8 px-6 py-16" data-preview-ready="true">
  <header class="grid gap-2">
    <h1 class="type-title">Chat media states</h1>
    <p class="type-body text-muted-foreground">
      Use the theme switcher and keyboard to inspect loading, recovery, and narrow layouts.
    </p>
  </header>

  <section class="grid min-w-0 max-w-2xl gap-3" aria-label="Markdown media failure">
    <h2 class="type-body font-medium!">In a chat message</h2>
    <MarkdownViewer content={markdown} />
  </section>

  <section class="grid min-w-0 max-w-2xl gap-3" aria-label="Media recovery controls">
    <h2 class="type-body font-medium!">Recovery controls</h2>
    <MediaUnavailable
      name="architecture.png"
      reason="load-failed"
      path=".intent/artifacts/architecture.png"
      {workspaceId}
      onRetry={() => retryCount++}
    />
    <p class="type-caption text-muted-foreground" role="status">
      Retry callback invoked {retryCount} times. This row demonstrates the control only.
    </p>
  </section>

  <section class="grid w-full min-w-0 max-w-xs gap-3" aria-label="Narrow media states">
    <h2 class="type-body font-medium!">Narrow layout</h2>
    <div class="grid min-w-0 gap-4 whitespace-pre-wrap" data-testid="narrow-media-states">
      <MediaLoadingPlaceholder name={longName} />
      <MediaUnavailable
        name={longName}
        reason="load-failed"
        path={`.intent/artifacts/${longName}`}
        {workspaceId}
        onRetry={() => retryCount++}
      />
      <MediaUnavailable name="recording.webm" reason="unsupported" path="recording.webm" />
      <MediaUnavailable
        name="reference.png"
        reason="other-workspace"
        path="reference.png"
        workspaceId="another-workspace"
      />
      <MediaUnavailable reason="invalid-link" />
      <MediaUnavailable reason="missing" />
      <MediaLoadingPlaceholder />
    </div>
  </section>
</article>
