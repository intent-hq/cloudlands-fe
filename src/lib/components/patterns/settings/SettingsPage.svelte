<script lang="ts">
  import type { Snippet } from 'svelte';
  import SettingsSidebarNav from '$lib/components/settings/SettingsSidebarNav.svelte';
  import { SettingsPageShell } from '$lib/components/ui/settings-page-shell';
  import * as Tabs from '$lib/components/ui/tabs';
  import SettingsForm from './SettingsForm.svelte';
  import type { SettingsCustomControls, SettingsSchema, SettingsTab } from './types';

  let {
    title,
    description,
    schema,
    searchQuery = '',
    custom = {},
    navigation: navigationContent,
    activeTab,
    onSelect,
    agentsNavigation,
    sidebarHeader,
    sidebarFooter,
    children,
  }: {
    title: string;
    description?: string;
    schema?: SettingsSchema;
    searchQuery?: string;
    custom?: SettingsCustomControls;
    navigation?: Snippet;
    activeTab: SettingsTab;
    onSelect: (tab: SettingsTab) => void;
    agentsNavigation: Snippet;
    sidebarHeader?: Snippet;
    sidebarFooter?: Snippet;
    children?: Snippet;
  } = $props();
</script>

<div data-slot="settings-page" class="flex h-full min-w-0">
  <aside
    class="flex h-full w-60 shrink-0 flex-col border-r border-border bg-sidebar dark:border-border"
  >
    {@render sidebarHeader?.()}
    <SettingsSidebarNav {activeTab} {onSelect} {agentsNavigation} />
    {@render sidebarFooter?.()}
  </aside>

  {#if children}
    {@render children()}
  {:else if schema}
    <div class="min-w-0 flex-1">
      <SettingsPageShell {title} {description} navigationLabel={title}>
        {#snippet navigation()}
          <div class="sticky top-0 z-10 bg-card">
            {#if navigationContent}
              {@render navigationContent()}
            {:else}
              {#each schema.sections.filter((section) => section.when?.() ?? true) as section (section.id)}
                <Tabs.Trigger value={section.id}>{section.title}</Tabs.Trigger>
              {/each}
            {/if}
          </div>
        {/snippet}
        <SettingsForm {schema} {searchQuery} {custom} />
      </SettingsPageShell>
    </div>
  {/if}
</div>
