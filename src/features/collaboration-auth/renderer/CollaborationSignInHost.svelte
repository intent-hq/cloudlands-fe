<script lang="ts">
  import { onMount } from 'svelte';
  import type { CollaborationView } from '../types';
  import CollaborationSignInModal from './CollaborationSignInModal.svelte';
  import { collaborationAction, installCollaborationAuth } from './collaboration-auth.client';
  let view = $state<CollaborationView | null>(null);
  onMount(() =>
    // eslint-disable-next-line intent/no-component-async-data-fetch -- installs the transient main-process consent dialog; auth state and polling stay in main
    installCollaborationAuth({
      show: (next) => {
        view = next;
      },
      dismiss: () => {
        view = null;
      },
    }),
  );
</script>

{#if view}
  <CollaborationSignInModal
    {view}
    onAction={(action) => {
      // eslint-disable-next-line intent/no-component-async-data-fetch -- ephemeral consent/PAT message to the local main-process flow; no domain state or renderer polling
      void collaborationAction(action).catch(() => {});
    }}
  />
{/if}
