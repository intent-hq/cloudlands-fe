<script lang="ts">
  import { onMount } from 'svelte';
  import { store } from '$store/renderer/store';
  import { hydrateWorkspaceInitializer } from '$store/renderer/slices/workspace-initializer/workspace-initializer-slice';
  import { setLabsPlainFolderWorkspacesEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import { systemStatusSuccess } from '$store/renderer/slices/daemon-health/daemon-health-slice';
  import NewSpaceModal from '../NewSpaceModal.svelte';

  /** Bump to ask the open dialog to re-read the `workspace-prefill` entry. */
  let {
    prefillRequest = 0,
    plainFolders = false,
  }: { prefillRequest?: number; plainFolders?: boolean } = $props();

  let ready = $state(false);
  onMount(() => {
    if (plainFolders) {
      // Labs plain folders on a daemon that can create them.
      store.dispatch(setLabsPlainFolderWorkspacesEnabled(true));
      store.dispatch(
        systemStatusSuccess(
          {
            running: true,
            listenMode: 'local',
            protocolVersion: '15.3',
            host: { os: 'linux', arch: 'x86_64', locality: 'local' },
          },
          new Date().toISOString(),
          store.state.daemonHealth.connectionGeneration,
        ),
      );
    }
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
