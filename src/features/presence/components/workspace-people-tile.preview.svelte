<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  interface Props {
    count?: number;
    offline?: boolean;
    sidebar?: boolean;
    shared?: boolean;
  }

  export const preview = definePreview<Props>({
    id: 'workspace-people-tile',
    title: 'Workspace people tile',
    defaultState: 'sidebar',
    states: {
      sidebar: { props: { sidebar: true } },
      tile: { props: {} },
      overflow: { props: { count: 8 } },
      offline: { props: { offline: true } },
      unshared: { props: { shared: false, sidebar: true } },
    },
  });
</script>

<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import WorkspacePeopleTile from './WorkspacePeopleTile.svelte';
  import MultiSelectTabbedSidebar from '$lib/components/workspace/MultiSelectTabbedSidebar.svelte';
  import { store } from '$store/renderer/store';
  import { admitLegacyPrincipal } from '../../../test/fixtures/principal-state';
  import { selectPresenceContext } from '$store/renderer/slices/presence/presence-selectors';
  import {
    presenceContextReceived,
    presenceReset,
    presenceMembersReceived,
    presenceRosterReceived,
    presenceWorkspacesReceived,
  } from '$store/renderer/slices/presence/presence-slice';
  import {
    setWorkspaceEntity,
    removeWorkspaceEntity,
  } from '$store/renderer/slices/workspace/workspace-slice';
  import { setMultiSelectSidebarSelectedTabs } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import { setLabsMultiplayerEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import { WorkspaceStatus } from '$shared/types';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { PREVIEW_FIXTURE_TIMESTAMPS } from '$lib/component-catalog/preview-fixtures';

  let { count = 3, offline = false, sidebar = false, shared = true }: Props = $props();
  const workspaceId = 'people-tile-preview';
  const previousMultiplayer = store.state.userPreferences.labsMultiplayerEnabled;

  untrack(() => {
    store.dispatch(setLabsMultiplayerEnabled(true));
    admitLegacyPrincipal();
    store.dispatch(
      setWorkspaceEntity({
        id: WorkspaceId(workspaceId),
        title: 'Redesign the workspace',
        repositoryName: 'intent',
        branch: 'feat/sidebar-people-tile',
        status: WorkspaceStatus.Active,
        myRole: 'owner',
        memberCount: shared ? count + 1 : 1,
        statusMessage: 'Bringing people and their work together.',
        changesets: [],
        timeline: [],
        conversationInfo: [],
        ...PREVIEW_FIXTURE_TIMESTAMPS,
      }),
    );
    store.dispatch(setMultiSelectSidebarSelectedTabs(workspaceId, ['overview']));
    store.dispatch(presenceContextReceived(selectPresenceContext.select(store.state)!, 'viewer'));
    store.dispatch(presenceWorkspacesReceived([workspaceId]));
    const names = ['Sam', 'Alex', 'Morgan', 'Taylor', 'Robin', 'Jamie', 'Casey', 'Charlie'];
    const people = names.slice(0, count).map((name, index) => ({
      principalId: `person-${index}`,
      login: name.toLowerCase(),
      displayName: name,
      avatarUrl: null,
      role: 'collaborator' as const,
      addedAt: PREVIEW_FIXTURE_TIMESTAMPS.createdAt,
    }));
    store.dispatch(presenceMembersReceived(workspaceId, people));
    store.dispatch(
      presenceRosterReceived({
        workspaceId,
        members: offline
          ? []
          : people.map((person) => ({ ...person, focus: [{ workspaceId }], typing: [] })),
      }),
    );
  });

  onDestroy(() => {
    store.dispatch(presenceReset());
    store.dispatch(setLabsMultiplayerEnabled(previousMultiplayer));
    store.dispatch(removeWorkspaceEntity(workspaceId));
  });
</script>

{#if sidebar}
  <div class="h-[780px] w-full max-w-[346px] bg-sidebar" data-people-sidebar-preview>
    <MultiSelectTabbedSidebar {workspaceId} />
  </div>
{:else}
  <div class="w-full max-w-[298px]" data-people-tile-preview>
    <WorkspacePeopleTile {workspaceId} />
  </div>
{/if}
