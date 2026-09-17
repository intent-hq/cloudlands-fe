<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import ChatPanelComposerGeometryHost from '../__tests__/ChatPanelComposerGeometryHost.svelte';

  interface Props {
    collapsed?: boolean;
    short?: boolean;
  }

  export const preview = definePreview<Props>({
    id: 'question-overlay',
    title: 'Composer question overlay',
    defaultState: 'expanded',
    states: {
      expanded: { props: {} },
      collapsed: { props: { collapsed: true } },
      short: { props: { short: true } },
    },
  });
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import { appClient } from '$lib/client';

  let { collapsed = false, short = false }: Props = $props();
  let width = $state(720);
  const previousGetQueue = appClient.agents.getQueue;
  appClient.agents.getQueue = async (agentId) =>
    agentId === 'regular-composer-agent' ? [] : previousGetQueue.call(appClient.agents, agentId);
  onDestroy(() => {
    appClient.agents.getQueue = previousGetQueue;
  });
</script>

<div class="w-full min-w-0" bind:clientWidth={width}>
  <ChatPanelComposerGeometryHost
    {width}
    height={short ? 320 : 640}
    questions
    initializeStore={false}
    draft={collapsed ? 'Keep this draft while I review the question.' : ''}
  />
</div>
