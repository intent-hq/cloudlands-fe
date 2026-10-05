<script lang="ts">
  import { onMount } from 'svelte';
  import { store } from '$store/renderer/store';
  import { hydrateWorkspaceInitializer } from '$store/renderer/slices/workspace-initializer/workspace-initializer-slice';
  import NewSpaceModal from './NewSpaceModal.svelte';

  let ready = $state(false);
  onMount(() => {
    store.dispatch(
      hydrateWorkspaceInitializer({
        compactFormState: {
          repoPath: '/fixture/design-system',
          repoType: 'local',
          isValidPath: true,
          branch: 'main',
          selectedProvider: 'codex',
        },
      }),
    );
    ready = true;
  });
</script>

{#if ready}<NewSpaceModal open={true} />{/if}
