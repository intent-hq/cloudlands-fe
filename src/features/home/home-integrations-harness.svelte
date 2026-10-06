<script lang="ts">
  import { onDestroy } from 'svelte';
  import { admitLegacyPrincipal } from '../../test/fixtures/principal-state';
  import { store } from '$store/renderer/store';
  import { startHomePreview } from './home-preview-lifecycle';
  import { guestSessionsListUnavailable } from '$store/renderer/slices/guest-sessions/guest-sessions-slice';
  import { replaceWorkspaceList } from '$store/renderer/slices/workspace/workspace-slice';
  import HomeIntegrations from './HomeIntegrations.svelte';
  import { setupHomeIntegrationsFixtures } from './home-integrations-browser-fixtures';
  import type { HomeIntegrationKind } from './home-integrations-types';
  import type { Workspace } from '$shared/types';
  let {
    kind = 'prs',
    organization,
    repoCount = 2,
    workspaces = [],
  }: {
    kind?: HomeIntegrationKind;
    organization?: string;
    repoCount?: number;
    workspaces?: Workspace[];
  } = $props();
  const dispose = startHomePreview(() => [setupHomeIntegrationsFixtures(store)]);
  admitLegacyPrincipal();
  store.dispatch(guestSessionsListUnavailable());
  $effect(() => {
    store.dispatch(replaceWorkspaceList(workspaces));
  });
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
  <HomeIntegrations {organization} {kind} {repositories} workspaceId="home-route" />
</div>
