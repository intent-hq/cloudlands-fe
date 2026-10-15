<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  export const preview = definePreview({
    id: 'browser-activity',
    title: 'Browser activity',
    defaultState: 'opened',
    states: { opened: { props: {} } },
  });
</script>

<script lang="ts">
  import ToolCall from '$lib/components/chat/ToolCall.svelte';
  import { store as appStore } from '$store/renderer/store';
  import { openHiddenTab } from '$store/renderer/slices/panel-layout/panel-layout-slice';

  const workspaceId = 'browser-activity-preview';
  const destinations = [
    { tabId: 'browser-docs', url: 'https://svelte.dev/docs/svelte/overview' },
    { tabId: 'browser-local', url: 'http://daemon.localhost:5173/sandbox' },
    {
      tabId: 'browser-long',
      url: 'https://a-very-long-preview-hostname-for-narrow-chat-layouts.example.com/page',
    },
  ];
  for (const destination of destinations) {
    appStore.dispatch(
      openHiddenTab(
        workspaceId,
        {
          type: 'browser',
          closable: true,
          title: destination.url,
          browserUrl: destination.url,
          ownerAgentId: 'preview-agent',
        },
        destination.tabId,
      ),
    );
  }
</script>

<div
  class="w-full min-w-0 space-y-3 bg-background p-4 text-foreground"
  data-testid="browser-activity-preview"
>
  {#each destinations as destination}
    <ToolCall
      {workspaceId}
      toolUse={{
        type: 'tool_use',
        id: `open-${destination.tabId}`,
        name: 'workspace_api',
        input: {
          code: `return await ws.browser.exec([{ action: 'openTab', url: '${destination.url}', visible: true }])`,
          summary: 'Open the preview',
        },
      }}
      result={JSON.stringify({
        action: 'openTab',
        success: true,
        result: { success: true, ...destination },
      })}
    />
  {/each}
</div>
