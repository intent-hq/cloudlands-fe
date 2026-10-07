<script lang="ts">
  import { goto } from '$app/navigation';
  import type { RepositoryGroup } from '$lib/components/workspace/utils/workspace-grouping';
  import type { Workspace } from '$shared/types';
  import { m } from '$shared/paraglide/messages.js';
  import { store } from '$store/renderer/store';
  import { openWorkspaceTab } from '$store/renderer/slices/tab-state/tab-state-slice';
  import HomeWorkspaceCity from './city/HomeWorkspaceCity.svelte';
  import { buildCityModel } from './city/home-city-model';
  import { matchesHomeFilter } from './home-model';
  import {
    selectHomeWorkspaceView,
    selectHomeWorkspaceSummaries,
  } from './home-workspaces-selectors';
  import { updateHomeWorkspaceView } from './home-workspaces-slice';

  let {
    workspaces,
    groups,
    matchingIds,
    onsearch,
    onclear,
  }: {
    workspaces: Workspace[];
    groups: RepositoryGroup[];
    matchingIds: string[];
    onsearch: () => void;
    onclear: () => void;
  } = $props();

  const view$ = selectHomeWorkspaceView();
  const summaries$ = selectHomeWorkspaceSummaries();
  // Search, triage and date filters only dim the city. Archive scope changes its
  // lifecycle population; repository scope may focus a smaller set of islands.
  const model = $derived(
    buildCityModel(
      workspaces.filter((workspace) =>
        matchesHomeFilter(workspace, $view$.filter === 'archived' ? 'archived' : 'all'),
      ),
      groups,
      m.home_city_inbox(),
      $summaries$,
    ),
  );

  function openWorkspace(id: string) {
    store.dispatch(openWorkspaceTab(id));
    void goto(`/workspace/${encodeURIComponent(id)}`);
  }
</script>

<HomeWorkspaceCity
  {model}
  {matchingIds}
  query={$view$.query}
  layout={$view$.cityLayout}
  rendering={$view$.cityRendering}
  onlayout={(cityLayout) => store.dispatch(updateHomeWorkspaceView({ cityLayout }))}
  onrendering={(cityRendering) => store.dispatch(updateHomeWorkspaceView({ cityRendering }))}
  {onsearch}
  {onclear}
  onopen={openWorkspace}
  onlist={() => store.dispatch(updateHomeWorkspaceView({ view: 'list' }))}
/>
