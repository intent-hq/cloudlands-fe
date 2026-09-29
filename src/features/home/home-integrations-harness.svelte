<script lang="ts">
  import { onDestroy } from 'svelte';
  import { store } from '$store/renderer/store';
  import { startHomePreview } from './home-preview-lifecycle';
  import { guestSessionsListUnavailable } from '$store/renderer/slices/guest-sessions/guest-sessions-slice';
  import { replaceWorkspaceList } from '$store/renderer/slices/workspace/workspace-slice';
  import HomeIntegrations from './HomeIntegrations.svelte';
  import { setupHomeIntegrationsFixtures } from './home-integrations-browser-fixtures';
  import type { HomeIntegrationKind } from './home-integrations-types';
  let { kind = 'prs', repoCount = 2 }: { kind?: HomeIntegrationKind; repoCount?: number } =
    $props();
  const dispose = startHomePreview(() => [setupHomeIntegrationsFixtures(store)]);
  store.dispatch(guestSessionsListUnavailable());
  store.dispatch(replaceWorkspaceList([]));
  const repositories = $derived(
    Array.from({ length: repoCount }, (_, index) => ({
      key: `repo-${index}`,
      owner: 'acme',
      name: index === 0 ? 'studio' : index === 1 ? 'platform' : `repo${index + 1}`,
    })),
  );
  onDestroy(dispose);
</script>

<div class="h-[700px] w-full bg-background text-foreground">
  <HomeIntegrations {kind} {repositories} workspaceId="home-route" />
</div>
