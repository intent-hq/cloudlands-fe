<script lang="ts">
  import { setContext } from 'svelte';
  import MessageContent from '$lib/components/chat/MessageContent.svelte';
  import StreamingMessageContent from '$lib/components/chat/StreamingMessageContent.svelte';
  import CodeBlock from '$lib/components/editor/CodeBlock.svelte';
  import { store } from '$store/renderer/store';
  import type { ContentBlock, MessageRole } from '$shared/types';
  import { followBottom } from '$lib/utils/smartScroll';
  import { inlineHtmlDemo, inlineHtmlMessage } from './inline-html-demo';

  store.init();
  setContext('panelLayoutManager', () => ({ splitPanel() {}, reopenClosedTab() {} }));

  interface Props {
    message?: string;
    isStreaming?: boolean;
    renderer?: 'static' | 'streaming' | 'before';
    role?: MessageRole;
    scrollable?: boolean;
    follow?: boolean;
    tailHeight?: number;
  }

  let {
    message = inlineHtmlMessage(),
    isStreaming = false,
    renderer = 'streaming',
    role = 'assistant',
    scrollable = false,
    follow = false,
    tailHeight = 960,
  }: Props = $props();

  const content = $derived<ContentBlock[]>([{ type: 'text', text: message }]);

  export function update(next: Props) {
    if (next.message !== undefined) message = next.message;
    if (next.isStreaming !== undefined) isStreaming = next.isStreaming;
    if (next.renderer !== undefined) renderer = next.renderer;
    if (next.role !== undefined) role = next.role;
    if (next.scrollable !== undefined) scrollable = next.scrollable;
    if (next.follow !== undefined) follow = next.follow;
    if (next.tailHeight !== undefined) tailHeight = next.tailHeight;
  }
</script>

<main
  class="min-h-screen bg-background px-6 py-8 text-foreground type-body"
  class:h-screen={scrollable}
  class:overflow-y-auto={scrollable}
  use:followBottom={{
    enabled: scrollable,
    follow,
    onFollowChange: (value) => (follow = value),
  }}
  data-testid="inline-html-scroll-container"
  data-following={follow}
>
  <article class="mx-auto min-w-0 max-w-2xl" data-testid="inline-html-chat">
    {#if scrollable}<div style:height="900px">Earlier messages</div>{/if}
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
    {#if scrollable}<div style:height={`${tailHeight}px`}>Later messages</div>{/if}
  </article>
</main>
