<script lang="ts">
  import { onMount } from 'svelte';
  import { store } from '$store/renderer/store';
  import { hydrateWorkspaceInitializer } from '$store/renderer/slices/workspace-initializer/workspace-initializer-slice';
  import NewSpaceModal from '../NewSpaceModal.svelte';

  /** Bump to ask the open dialog to re-read the `workspace-prefill` entry. */
  let { prefillRequest = 0 }: { prefillRequest?: number } = $props();

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
        // A local clone of octo/app: a plain GitHub prefill resolves to it.
        recentRepos: [
          {
            path: '/fixture/my-checkout',
            type: 'local',
            name: 'app',
            owner: 'octo',
            githubUrl: 'https://github.com/octo/app',
          },
        ],
      }),
    );
    ready = true;
  });
</script>

{#if ready}<NewSpaceModal open={true} {prefillRequest} />{/if}
