<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  export const preview = definePreview({
    id: 'tooltip-audit',
    title: 'Useful tooltip behavior',
    defaultState: 'default',
    states: { default: { props: {} } },
  });
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { observeOverflow, truncatedTitle } from '$lib/actions/observe-overflow';
  import { ActionBar } from '$lib/components/patterns/action-menu';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { ListItem } from '$lib/components/ui/list';
  import { faCopy } from '$lib/icons/phosphor-icons';
  import PanelTabBar from '$lib/components/layout/panel-system/PanelTabBar.svelte';
  import MediaLoadingPlaceholder from '$lib/components/ui/MediaLoadingPlaceholder.svelte';
  import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';
  import { store } from '$store/renderer/store';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';

  let label = $state('dev bro');
  let narrow = $state(true);
  let showLabels = $state(true);
  let activeTabId = $state('audit-agent');
  let lastAction = $state('');
  let noteOverflow = $state(false);
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
</section>
