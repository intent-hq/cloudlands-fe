<script lang="ts">
  import { m } from '$shared/paraglide/messages.js';
  import SmartCornerTabs, {
    type SmartCornerTab,
  } from '$lib/components/ui/smart-corner-tabs/SmartCornerTabs.svelte';

  let activeTabId = $state('overview');
  const tabs = $derived<SmartCornerTab[]>([
    { id: 'overview', label: m.layout_tabTypes_overview_title() },
    { id: 'changes', label: m.layout_tabTypes_changes_title() },
    { id: 'activity', label: m.layout_tabTypes_activityChanges_title() },
    { id: 'browser', label: m.layout_tabTypes_browser_title() },
    { id: 'terminal', label: m.layout_tabTypes_terminal_title() },
  ]);

  function handleTabChange(tabId: string) {
    activeTabId = tabId;
  }
</script>

<svelte:head>
  <title>{m.layout_panelLayout_ariaLabel()}</title>
</svelte:head>

<div class="min-h-full overflow-auto bg-background px-4 py-8 sm:px-8">
  <div class="mx-auto w-full max-w-4xl">
    <SmartCornerTabs
      {tabs}
      {activeTabId}
      onTabChange={handleTabChange}
      panelId="smart-corner-demo-panel"
      ariaLabel={m.layout_panelLayout_ariaLabel()}
    >
      {#snippet children(tab)}
        <div class="grid gap-3">
          <p class="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {tab.label}
          </p>
          <h1 class="text-2xl font-semibold tracking-tight text-card-foreground">
            {m.layout_layoutHeader_single_description()}
          </h1>
          <p class="max-w-2xl text-sm leading-6 text-muted-foreground">
            {m.layout_layoutHeader_focusModes_header()}
          </p>
          <div class="grid gap-3 sm:grid-cols-3">
            <div class="h-20 rounded-lg border border-border/70 bg-muted/40"></div>
            <div class="h-20 rounded-lg border border-border/70 bg-muted/40"></div>
            <div class="h-20 rounded-lg border border-border/70 bg-muted/40"></div>
          </div>
        </div>
      {/snippet}
    </SmartCornerTabs>

    <p class="mt-4 text-xs text-muted-foreground" data-smart-corner-demo-state>
      {tabs.find((tab) => tab.id === activeTabId)?.label}
    </p>
  </div>
</div>
