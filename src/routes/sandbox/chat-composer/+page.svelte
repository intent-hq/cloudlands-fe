<script lang="ts">
  import { page } from '$app/state';
  import QueuedMessageList from '$lib/components/chat/QueuedMessageList.svelte';
  import SimpleRichInput from '$lib/components/chat/input/SimpleRichInput.svelte';
  import type { ContextItem } from '$lib/components/chat/input/context-api';
  import type { QueuedMessage } from '$shared/types';

  const timestamp = '2026-09-05T04:00:00.000Z';
  let value = $state(
    page.url.searchParams.get('state') === 'queue'
      ? 'Queue this follow-up while the agent is responding.'
      : '',
  );
  let contextItems = $state<ContextItem[]>([]);
  let messages = $state<QueuedMessage[]>([
    {
      id: 'queued-message-one',
      content: 'Review the updated visual hierarchy and spacing.',
      queuedAt: timestamp,
      position: 0,
    },
    {
      id: 'queued-message-two',
      content:
        'Then verify the full interaction flow at narrow widths and document any remaining visual differences.',
      queuedAt: timestamp,
      position: 1,
    },
  ]);

  const previewState = $derived(page.url.searchParams.get('state') ?? 'rest');
  const isStreaming = $derived(previewState === 'stop' || previewState === 'queue');

  async function editMessage(messageId: string, content: string) {
    messages = messages.map((message) =>
      message.id === messageId ? { ...message, content } : message,
    );
    return { success: true };
  }

  function removeMessage(messageId: string) {
    messages = messages.filter((message) => message.id !== messageId);
  }
</script>

<article class="showcase-page" data-preview-ready="true" data-capture-state={previewState}>
  <header>
    <h1>Chat composer</h1>
    <p>A deterministic showcase of the production rich editor and daemon-backed queue rows.</p>
  </header>

  <section
    id="chat-composer-overlays"
    class="composer-stage"
    aria-label="Chat composer preview"
    data-testid="chat-composer-showcase"
  >
    <SimpleRichInput
      bind:value
      bind:contextItems
      workspace={null}
      currentContext={null}
      {isStreaming}
      isResponding={isStreaming}
      editorClassName="w-full px-4! sm:px-6!"
      contentInsetClassName="w-full px-4 sm:px-6"
      tooltipPortalTarget="#chat-composer-overlays"
      edgeDocked
      onsubmit={() => {}}
      onforcesubmit={() => {}}
      onstop={() => {}}
    >
      {#snippet queueRegion()}
        <QueuedMessageList
          {messages}
          onedit={editMessage}
          onremove={removeMessage}
          onsendnow={removeMessage}
        />
      {/snippet}
    </SimpleRichInput>
  </section>
</article>

<style>
  .showcase-page {
    display: grid;
    width: 100%;
    min-width: 0;
    gap: 2rem;
    padding: 7rem 1.5rem;
  }

  header p {
    max-width: 34rem;
  }

  h1 {
    font-size: 1.75rem;
    font-weight: 400;
    line-height: 1;
  }

  header p {
    margin-top: 0.5rem;
    color: hsl(var(--muted-foreground));
    font-size: var(--text-caption-size);
    line-height: 1.6;
  }

  .composer-stage {
    width: min(100%, 760px);
    min-width: 0;
    margin-inline: auto;
  }
</style>
