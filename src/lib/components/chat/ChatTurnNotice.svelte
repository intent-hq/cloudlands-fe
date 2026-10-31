<script lang="ts">
  import type { Snippet } from 'svelte';
  import { extractAllContent, type AgentMessage } from '$shared/types';
  import ModelChangeNotice from './ModelChangeNotice.svelte';
  import EffortChangeNotice from './EffortChangeNotice.svelte';
  import ProviderRehomedNotice from './ProviderRehomedNotice.svelte';
  import { getModelChangeNotice } from './model-change-notice';
  import { getEffortChangeNotice } from './effort-change-notice';
  import { getProviderRehomedNotice } from './rehome-notice';

  let {
    message,
    workspaceId,
    fallback,
  }: { message: AgentMessage; workspaceId?: string; fallback?: Snippet } = $props();
  const model = $derived(getModelChangeNotice(message));
  const effort = $derived(getEffortChangeNotice(message));
  const provider = $derived(getProviderRehomedNotice(message));
  const fallbackText = $derived(extractAllContent(message) || undefined);
</script>

{#if model || effort || provider}
  <div data-message-id={message.id} class="px-2">
    {#if model}
      <ModelChangeNotice {workspaceId} notice={model} {fallbackText} />
    {:else if effort}
      <EffortChangeNotice notice={effort} {fallbackText} />
    {:else if provider}
      <ProviderRehomedNotice {workspaceId} notice={provider} {fallbackText} />
    {/if}
  </div>
{:else if fallback}
  {@render fallback()}
{/if}
