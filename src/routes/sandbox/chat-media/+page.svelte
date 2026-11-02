<script lang="ts">
  import { page } from '$app/state';
  import MarkdownViewer from '$lib/components/markdown/MarkdownViewer.svelte';
  import MediaLoadingPlaceholder from '$lib/components/ui/MediaLoadingPlaceholder.svelte';
  import MediaUnavailable from '$lib/components/ui/MediaUnavailable.svelte';
  import ChatImageBlock from '$lib/components/chat/ChatImageBlock.svelte';
  import ToolCall from '$lib/components/chat/ToolCall.svelte';

  let retryCount = $state(0);
  const workspaceId = $derived(page.url.searchParams.get('workspace') || undefined);
  const longName = 'architecture-review-with-a-very-long-unbroken-filename-for-narrow-layouts.png';
  const markdown = [
    '### Architecture preview',
    'The media state should stay quiet between ordinary chat paragraphs.',
    '![Architecture preview](data:image/png;base64,invalid)',
    'The conversation continues here without a large error card.',
  ].join('\n\n');
  // §5.5 capped block reads: blocks a capped `agent.getMessageBlock` could not serve whole.
  const thumbnail =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const cutOutput = Array.from({ length: 40 }, (_, i) => `line ${i + 1}: build step output`).join(
    '\n',
  );
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

  <section class="grid min-w-0 max-w-2xl gap-3" aria-label="Truncated message blocks">
    <h2 class="type-body font-medium!">Too large to show in full</h2>
    <ToolCall
      saved={{ expanded: true }}
      toolUse={{
        type: 'tool_use',
        id: 'sandbox-msg:0',
        name: 'launch-process',
        input: { command: 'cat build.log' },
      }}
      result={cutOutput}
      resultBlock={{
        type: 'tool_result',
        id: 'sandbox-msg:1',
        tool_use_id: 'sandbox-call',
        output: cutOutput,
        servedTruncation: { shownBytes: 479_900, totalBytes: 3_355_443 },
      }}
    />
    <ChatImageBlock
      data={thumbnail}
      mimeType="image/png"
      width={1600}
      height={900}
      dataTruncated
      dataIsThumbnail
      onHydrate={() => {}}
      tooLarge
    />
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
