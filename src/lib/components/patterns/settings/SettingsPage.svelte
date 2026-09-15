<script lang="ts">
  import type { Snippet } from 'svelte';
  import SettingsSidebarNav from '$lib/components/settings/SettingsSidebarNav.svelte';
  import { SettingsPageShell } from '$lib/components/ui/settings-page-shell';
  import * as Tabs from '$lib/components/ui/tabs';
  import SettingsForm from './SettingsForm.svelte';
  import type {
    SettingsCustomControls,
    SettingsDescriptionSnippets,
    SettingsSchema,
    SettingsTab,
  } from './types';

  let {
    title,
    description,
    schema,
    searchQuery = '',
    custom = {},
    descriptions = {},
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
    descriptions?: SettingsDescriptionSnippets;
    navigation?: Snippet;
    activeTab: SettingsTab;
    onSelect: (tab: SettingsTab) => void;
    agentsNavigation: Snippet;
    sidebarHeader?: Snippet;
    sidebarFooter?: Snippet;
    children?: Snippet;
  } = $props();
</script>

<div data-slot="settings-page" class="flex h-full min-h-0 min-w-0 overflow-hidden">
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
        <SettingsForm {schema} {searchQuery} {custom} {descriptions} />
      </SettingsPageShell>
    </div>
  {/if}
</div>

<style>
  [data-slot='settings-page'] :global([data-slot='settings-section-body']),
  [data-slot='settings-page'] :global([data-slot='settings-section-content']) {
    padding: var(--space-4) var(--space-5);
  }

  [data-slot='settings-page']
    :global([data-slot='settings-section-body'] > [data-slot='settings-field-row']:first-child),
  [data-slot='settings-page']
    :global(
      [data-slot='settings-section-body']
        > [data-slot='settings-form']
        > [data-slot='settings-field-row']:first-child
    ),
  [data-slot='settings-page']
    :global([data-slot='settings-section-content'] > [data-slot='settings-field-row']:first-child) {
    padding-top: 0;
  }

  [data-slot='settings-page']
    :global([data-slot='settings-section-body'] > [data-slot='settings-field-row']:last-child),
  [data-slot='settings-page']
    :global(
      [data-slot='settings-section-body']
        > [data-slot='settings-form']
        > [data-slot='settings-field-row']:last-child
    ),
  [data-slot='settings-page']
    :global([data-slot='settings-section-content'] > [data-slot='settings-field-row']:last-child) {
    padding-bottom: 0;
  }
</style>
