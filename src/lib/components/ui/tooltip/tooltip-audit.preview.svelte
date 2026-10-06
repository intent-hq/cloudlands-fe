<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  export const preview = definePreview<{ showStatus?: boolean }>({
    id: 'tooltip-audit',
    title: 'Useful tooltip behavior',
    defaultState: 'default',
    states: {
      default: { props: {} },
      status: { props: { showStatus: true } },
    },
  });
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { observeOverflow, truncatedTitle } from '$lib/actions/observe-overflow';
  import { ActionBar } from '$lib/components/patterns/action-menu';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import { ListItem } from '$lib/components/ui/list';
  import { PREVIEW_FIXTURE_TIMESTAMPS } from '$lib/component-catalog/preview-fixtures';
  import { faCopy } from '$lib/icons/phosphor-icons';
  import PanelTabBar from '$lib/components/layout/panel-system/PanelTabBar.svelte';
  import MediaLoadingPlaceholder from '$lib/components/ui/MediaLoadingPlaceholder.svelte';
  import WorkspaceSidebarHeader from '$lib/components/workspace/WorkspaceSidebarHeader.svelte';
  import WorkspaceProgressCard from '$lib/components/workspace/sidebar/WorkspaceProgressCard.svelte';
  import { WorkspaceStatus, type Workspace } from '$shared/types';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
  import { store } from '$store/renderer/store';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';

  let { showStatus = false }: { showStatus?: boolean } = $props();
  let label = $state('dev bro');
  let statusMessage = $state('Ready for review');
  let narrow = $state(true);
  let showLabels = $state(true);
  let activeTabId = $state('audit-agent');
  let lastAction = $state('');
  let noteOverflow = $state(false);
  const workspaceId = WorkspaceId('tooltip-audit-workspace');
  const workspace = $derived<Workspace>({
    id: workspaceId,
    title: 'Tooltip audit',
    branch: 'tooltip-audit',
    status: WorkspaceStatus.Active,
    displayStatus: 'idle',
    attention: 'none',
    activity: 'idle',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    repositoryOwner: 'intent-hq',
    repositoryName: 'intent',
    repositoryPath: '/workspace',
    statusMessage,
    ...PREVIEW_FIXTURE_TIMESTAMPS,
  });
  const tabs = $derived<PanelTab[]>([
    {
      id: 'audit-agent',
      type: 'agent',
      title: label,
      agentId: 'tooltip-audit-agent',
      closable: false,
    },
    {
      id: 'audit-file',
      type: 'file',
      title: 'app.ts',
      filePath: '/workspace/src/app.ts',
      closable: false,
    },
  ]);

  onMount(() => startRootStoreLifecycle(store, { startSagas: () => [] }));
  $effect(() => {
    if (showStatus) store.dispatch(setWorkspaceEntity(workspace));
  });
</script>

<section class="grid w-full gap-6 p-4 text-foreground" data-testid="tooltip-audit">
  <div class="grid gap-2">
    <Input aria-label="Example name" bind:value={label} />
    <div class="flex gap-2">
      <Button variant="outline" size="sm" onclick={() => (narrow = !narrow)}>
        {narrow ? 'Widen labels' : 'Narrow labels'}
      </Button>
      <Button variant="outline" size="sm" onclick={() => (showLabels = !showLabels)}>
        {showLabels ? 'Hide labels' : 'Show labels'}
      </Button>
    </div>
  </div>

  <div class="max-w-full" style:width={narrow ? '300px' : '100%'} data-testid="label-surfaces">
    <PanelTabBar
      {tabs}
      {activeTabId}
      panelId="tooltip-audit-panel"
      workspaceId="tooltip-audit-workspace"
      onTabClick={(id) => (activeTabId = id)}
      isFocused
    />
    {#if showLabels}
      <div class="mt-4 grid gap-3">
        <ListItem title={label} onclick={() => (lastAction = 'list')} />
        <MediaLoadingPlaceholder name={label} />
        <span
          class="truncate"
          use:truncatedTitle={'/workspace/src/app.ts'}
          data-testid="abbreviated-label">app.ts</span
        >
        <span
          class="line-clamp-2 min-w-0 text-sm"
          use:truncatedTitle={label}
          use:observeOverflow={(overflow) => (noteOverflow = overflow)}
          data-testid="clamped-label"
          data-overflow={noteOverflow}>{label}</span
        >
      </div>
    {/if}
  </div>

  <ActionBar
    actions={[
      { id: 'save', label: 'Save' },
      { id: 'search', label: 'Find', shortcut: 'mod+f' },
      { id: 'publish', label: 'Publish', disabledReason: 'Connect an account to publish' },
      { id: 'copy', label: 'Copy', icon: faCopy },
    ]}
    overflowLabel="More actions"
    onAction={(id) => (lastAction = id)}
  />
  <output aria-label="Last action">{lastAction}</output>
  {#if showStatus}
    <Textarea aria-label="Example status" bind:value={statusMessage} />
    <div class="grid grid-cols-2 gap-6">
      <div class="min-w-0" data-testid="sidebar-status">
        <WorkspaceSidebarHeader {workspace} {workspaceId} />
      </div>
      <div class="min-w-0" data-testid="progress-status">
        <WorkspaceProgressCard {workspaceId} />
      </div>
    </div>
  {/if}
</section>
