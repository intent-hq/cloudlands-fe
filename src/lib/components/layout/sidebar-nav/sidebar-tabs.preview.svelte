<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { WorkspaceStatus, type Workspace } from '$shared/types';
  import { CHIEF_WORKSPACE_ID, WorkspaceId } from '$shared/types/branded-ids';

  interface Props {
    initialTab?: 'all-workspaces' | 'chief';
    width?: number;
    admittedOwner?: boolean;
  }

  const workspaces: Workspace[] = [
    ['preview-sidebar-tabs-design', 'Polish the workspace navigation', 'in_progress'],
    ['preview-sidebar-tabs-review', 'Review the release checklist', 'needs_attention'],
    ['preview-sidebar-tabs-docs', 'Document keyboard shortcuts', 'idle'],
    ['preview-sidebar-tabs-tests', 'Cover sidebar interactions', 'idle'],
  ].map(([id, title, displayStatus]) => ({
    id: WorkspaceId(id),
    title,
    branch: 'sidebar-preview',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatus.Active,
    displayStatus: displayStatus as Workspace['displayStatus'],
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: '2026-09-01T12:00:00.000Z',
  }));

  export const preview = definePreview<Props>({
    id: 'sidebar-tabs',
    title: 'Sidebar tabs',
    defaultState: 'workspaces',
    states: {
      workspaces: { props: { initialTab: 'all-workspaces', width: 288 } },
      intent: { props: { initialTab: 'chief', width: 288 } },
      narrow: { props: { initialTab: 'all-workspaces', width: 100 } },
    },
  });
</script>

<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import SidebarPanel from './SidebarPanel.svelte';
  import { store as appStore } from '$store/renderer/store';
  import {
    openPanel,
    setAllSpacesViewMode,
    setChiefActiveAgentId,
    setOnboardingActive,
    setPanelWidth,
    setShowArchivedWorkspaces,
  } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import {
    replaceWorkspaceList,
    setWorkspaceHasLoaded,
  } from '$store/renderer/slices/workspace/workspace-slice';
  import { setAgentsLoaded } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import { setActiveProvider } from '$store/renderer/slices/provider-settings/provider-settings-slice';
  import { guestSessionsListUnavailable } from '$store/renderer/slices/guest-sessions/guest-sessions-slice';
  import { activeStreamsTracker } from '$features/agent/services/active-streams-tracker';
  import { admitLegacyPrincipal } from '../../../../test/fixtures/principal-state';
  import {
    principalContextChanged,
    principalReceived,
  } from '$store/renderer/slices/principal/principal-slice';

  let { initialTab = 'all-workspaces', width = 288, admittedOwner = true }: Props = $props();

  // Both the named sandbox and CT bootstrap the store without production sagas.
  // A provider-less, loaded empty Intent workspace cannot auto-launch an agent.
  const previousPrincipal = untrack(() => {
    const previous = appStore.state.principal;
    if (admittedOwner) admitLegacyPrincipal();
    else appStore.dispatch(principalContextChanged(null));
    return previous;
  });
  appStore.dispatch(guestSessionsListUnavailable());
  appStore.dispatch(setActiveProvider(''));
  appStore.dispatch(setAgentsLoaded(CHIEF_WORKSPACE_ID, true));
  appStore.dispatch(setChiefActiveAgentId(null));
  appStore.dispatch(replaceWorkspaceList(workspaces));
  appStore.dispatch(setWorkspaceHasLoaded(true));
  appStore.dispatch(setAllSpacesViewMode('recent'));
  appStore.dispatch(setShowArchivedWorkspaces(false));
  appStore.dispatch(setOnboardingActive(false));

  $effect.pre(() => {
    appStore.dispatch(setPanelWidth(width));
    appStore.dispatch(openPanel(initialTab));
  });

  onDestroy(() => {
    activeStreamsTracker.stopPolling();
    appStore.dispatch(principalContextChanged(previousPrincipal.context));
    if (previousPrincipal.context && previousPrincipal.snapshot)
      appStore.dispatch(
        principalReceived(
          { context: previousPrincipal.context, invalidation: 0, presentationVersion: 0 },
          previousPrincipal.snapshot,
        ),
      );
  });
</script>

<div
  class="h-[560px] bg-sidebar text-sidebar-foreground"
  style:width={`${width}px`}
  data-sidebar-tabs-preview
  data-probe="sidebar-tabs"
>
  <SidebarPanel />
</div>
