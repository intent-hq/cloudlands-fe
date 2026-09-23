<script lang="ts">
  import { onDestroy } from 'svelte';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import InlineAgentAvatar from '$lib/components/chat/InlineAgentAvatar.svelte';

  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });
  onDestroy(disposeStore);
  let activations = $state(0);
  let modified = $state(false);
</script>

<section
  class="flex items-center gap-2 bg-card p-4"
  data-activations={activations}
  data-modified={modified}
>
  <div data-testid="header-owner">
    <InlineAgentAvatar
      agentId="header-owner-agent"
      agentName="Browser owner"
      presentation="header"
      onclick={(event) => {
        activations += 1;
        modified = event.metaKey || event.ctrlKey;
      }}
    />
  </div>
  <div data-testid="inline-owner">
    <InlineAgentAvatar agentId="inline-owner-agent" agentName="Inline owner" />
  </div>
</section>
