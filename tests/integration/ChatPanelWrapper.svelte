<script lang="ts">
  import { setContext, onMount } from 'svelte';

  // Provide the Tooltip context that ChatPanel expects
  // This needs to be set before any child components are created
  const tooltipContext = {
    delayDuration: 200,
    disableHoverableContent: false,
    disableCloseOnTriggerClick: false,
    disabled: false,
    ignoreNonKeyboardFocus: true,
    skipDelayDuration: 300,
  };

  setContext('Tooltip.Provider', tooltipContext);

  export let agentId: string;
  export let workspaceId: string;

  // Dynamically import ChatPanel to ensure context is set first
  let ChatPanel: any;
  let loading = true;

  onMount(async () => {
    const module = await import('../../src/lib/components/chat/ChatPanel.svelte');
    ChatPanel = module.default;
    loading = false;
  });
</script>

{#if !loading && ChatPanel}
  <svelte:component this={ChatPanel} {agentId} {workspaceId} />
{:else}
  <div>Loading...</div>
{/if}
