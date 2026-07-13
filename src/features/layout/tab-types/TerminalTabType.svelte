<script lang="ts">
  /**
   * Terminal Tab Type Component
   *
   * Renders a terminal session.
   */

  import type { TabTypeComponentProps } from './registry';
  import Terminal from '$lib/components/terminal/Terminal.svelte';

  let { tab, workspaceId }: TabTypeComponentProps = $props();

  const terminalId = $derived(tab.terminalId);
</script>

{#if terminalId}
  {#key terminalId}
    <Terminal {terminalId} {workspaceId} class="h-full" />
  {/key}
{/if}
