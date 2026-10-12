<script lang="ts">
  import { setContext } from 'svelte';
  import MessageContent from '$lib/components/chat/MessageContent.svelte';
  import StreamingMessageContent from '$lib/components/chat/StreamingMessageContent.svelte';
  import CodeBlock from '$lib/components/editor/CodeBlock.svelte';
  import { store } from '$store/renderer/store';
  import type { ContentBlock, MessageRole } from '$shared/types';
  import { inlineHtmlDemo, inlineHtmlMessage } from './inline-html-demo';

  store.init();
  setContext('panelLayoutManager', () => ({ splitPanel() {}, reopenClosedTab() {} }));

  interface Props {
    message?: string;
    isStreaming?: boolean;
    renderer?: 'static' | 'streaming' | 'before';
    role?: MessageRole;
  }

  let {
    message = inlineHtmlMessage(),
    isStreaming = false,
    renderer = 'streaming',
    role = 'assistant',
  }: Props = $props();

  const content = $derived<ContentBlock[]>([{ type: 'text', text: message }]);

  export function update(next: Props) {
    if (next.message !== undefined) message = next.message;
    if (next.isStreaming !== undefined) isStreaming = next.isStreaming;
    if (next.renderer !== undefined) renderer = next.renderer;
    if (next.role !== undefined) role = next.role;
  }
</script>

<main class="min-h-screen bg-background px-6 py-8 text-foreground type-body">
  <article class="mx-auto min-w-0 max-w-2xl" data-testid="inline-html-chat">
    <div class="mb-8 rounded-lg bg-sidebar px-4 py-3">
      Show me whether this monitor arm can clamp onto my desk.
    </div>
    {#if renderer === 'before'}
      <p>Here is an interactive cross-section.</p>
      <CodeBlock code={inlineHtmlDemo} language="ws-block:html" />
      <p>Adjust the thickness to see the available clearance.</p>
    {:else if renderer === 'static'}
      <MessageContent {content} {role} {isStreaming} messageId="inline-html-demo" />
    {:else}
      <StreamingMessageContent {content} {role} {isStreaming} messageId="inline-html-demo" />
    {/if}
  </article>
</main>
