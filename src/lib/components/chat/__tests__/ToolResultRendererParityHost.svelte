<script lang="ts">
  import { onDestroy } from 'svelte';
  import AgentMessageList from '../AgentMessageList.svelte';
  import MessageContent from '../MessageContent.svelte';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import type { AgentMessage, ContentBlock } from '$shared/types';

  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });
  onDestroy(disposeStore);

  let {
    content,
    isStreaming = true,
    searchQuery = '',
  }: { content: ContentBlock[]; isStreaming?: boolean; searchQuery?: string } = $props();
  const message = $derived({
    id: 'message-tool-result-parity',
    role: 'assistant',
    contentBlocks: content,
    isStreaming,
    timestamp: '2026-08-28T12:00:00.000Z',
  } as AgentMessage);
</script>

<section data-testid="normal-workspace-surface">
  <AgentMessageList
    messages={[message]}
    streamingContent={content}
    {isStreaming}
    {searchQuery}
    enableTransitions={false}
    workspaceId="tool-result-parity-workspace"
  />
</section>
<section data-testid="dedicated-agent-surface">
  <MessageContent
    {content}
    {isStreaming}
    role="assistant"
    workspaceId="tool-result-parity-workspace"
  />
</section>
