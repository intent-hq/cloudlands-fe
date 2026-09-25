<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import SimpleRichInput from '../SimpleRichInput.svelte';
  import { store as appStore } from '$store/renderer/store';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import {
    setWorkspace,
    setSelection,
    updatePanels,
  } from '$store/renderer/slices/multi-panel-context/multi-panel-context-slice';
  import { getMentionSystem, type MentionCandidate } from '$lib/services/mentions';
  import { WorkspaceStatus, type Workspace } from '$shared/types';
  import { WorkspaceId } from '$shared/types/branded-ids';

  let { placement = 'left', top = 300 }: { placement?: 'left' | 'right'; top?: number } = $props();
  let value = $state('');
  let queries = $state<{ query: string; workspaceId?: string }[]>([]);
  const workspace: Workspace = {
    id: WorkspaceId('context-picker-fixture'),
    title: 'Context picker fixture',
    branch: 'main',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatus.Active,
    createdAt: '2026-09-23T00:00:00Z',
    updatedAt: '2026-09-23T00:00:00Z',
  };
  const disposeStore = startRootStoreLifecycle(appStore, { startSagas: () => [] });
  appStore.dispatch(setWorkspace(workspace.id));
  appStore.dispatch(
    updatePanels([
      {
        id: 'note-1',
        panelId: 'panel-1',
        tabId: 'tab-1',
        type: 'note',
        label: 'Project notes',
        checked: false,
        isActive: true,
      },
      {
        id: 'file-1',
        panelId: 'panel-2',
        tabId: 'tab-2',
        type: 'file',
        label: 'app.ts',
        checked: true,
      },
    ]),
  );
  appStore.dispatch(
    setSelection({
      panelId: 'panel-1',
      tabId: 'tab-1',
      sourceType: 'note',
      sourceLabel: 'Project notes',
      text: 'Selected project excerpt',
      timestamp: 1,
    }),
  );
  const candidates: MentionCandidate[] = [
    {
      id: 'searched-file',
      type: 'file',
      label: 'Search result.ts',
      subtitle: 'src/features/context/search-result.ts',
      uri: 'file:///fixture/search-result.ts',
    },
    {
      id: 'build-terminal',
      type: 'terminal',
      label: 'Build terminal',
      uri: 'devspace://terminal/build-terminal',
    },
  ];
  onMount(() => {
    // eslint-disable-next-line intent/no-component-async-data-fetch -- isolated CT search boundary; no daemon requests
    const system = getMentionSystem();
    const originalSearch = system.search;
    system.search = async (query, context) => {
      queries = [...queries, { query, workspaceId: context.workspaceId }];
      return candidates.filter((item) => item.label.toLowerCase().includes(query.toLowerCase()));
    };
    return () => {
      system.search = originalSearch;
    };
  });
  onDestroy(disposeStore);
</script>

<section
  class="group/panel fixed"
  style:top={`${top}px`}
  style:left={placement === 'left' ? '24px' : undefined}
  style:right={placement === 'right' ? '24px' : undefined}
  style="width: min(440px, calc(100vw - 48px));"
>
  <SimpleRichInput bind:value {workspace} panelFocused autoFocus={false} />
</section>
<output class="sr-only" data-testid="context-search-queries">{JSON.stringify(queries)}</output>
