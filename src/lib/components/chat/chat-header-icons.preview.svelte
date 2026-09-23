<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  interface Props {
    atBottom?: boolean;
  }

  export const preview = definePreview<Props>({
    id: 'chat-header-icons',
    title: 'Chat header action icons',
    defaultState: 'scrolled',
    states: {
      scrolled: { props: { atBottom: false } },
      bottom: { props: { atBottom: true } },
    },
  });
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { store } from '$store/renderer/store';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import TaskProgressControl from '$lib/components/chat/TaskProgressControl.svelte';
  import BrowserTabsMenu from '$lib/components/chat/BrowserTabsMenu.svelte';
  import ChatMessageNavigator from '$lib/components/chat/ChatMessageNavigator.svelte';

  let { atBottom = false }: Props = $props();
  let scrolledToBottom = $state(false);
  let selectedMessage = $state('');
  const workspaceId = 'chat-header-icons-preview';
  const agentId = 'chat-header-icons-agent';
  onMount(() => startRootStoreLifecycle(store, { startSagas: () => [] }));
</script>

{#snippet primaryActions()}
  <div class="flex min-w-0 items-center gap-0.5">
    <TaskProgressControl
      tasks={[
        { id: 'review', status: 'review_required', title: 'Review the agent header actions' },
      ]}
      presentation="checklist"
    />
    <BrowserTabsMenu
      {workspaceId}
      {agentId}
      entries={[
        {
          tab: {
            id: 'preview-browser',
            type: 'browser',
            title: 'Preview page',
            ownerAgentId: agentId,
            closable: true,
          },
          panelId: 'header-panel',
          active: true,
          hidden: false,
        },
      ]}
    />
    <ChatMessageNavigator
      messages={[
        { id: 'first', text: 'Review header icons' },
        { id: 'last', text: 'Keep keyboard navigation' },
      ]}
      isAtBottom={atBottom || scrolledToBottom}
      onSelectMessage={(id) => {
        selectedMessage = id;
        return true;
      }}
      onScrollToBottom={() => (scrolledToBottom = true)}
    />
  </div>
{/snippet}

<section
  class="w-full bg-card text-card-foreground"
  data-testid="chat-header-icons-preview"
  data-selected-message={selectedMessage}
>
  <div class="flex items-center justify-end" data-chat-header-actions>
    {@render primaryActions()}
  </div>
</section>
