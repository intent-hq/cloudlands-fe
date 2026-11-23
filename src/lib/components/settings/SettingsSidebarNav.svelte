<script lang="ts">
  import { ListRow } from '$lib/components/patterns/collection';
  import { Button } from '$lib/components/patterns/settings/custom-controls';
  import { m } from '$shared/paraglide/messages.js';
  import type { Snippet } from 'svelte';
  import type { SettingsTab } from '$lib/components/patterns/settings/types';
  import { SETTINGS_NAV_GROUPS } from './settings-nav-items';

  interface Props {
    /** Undefined while a settings search replaces the tab pane. */
    activeTab: SettingsTab | undefined;
    onSelect: (tab: SettingsTab) => void;
    agentsNavigation: Snippet;
    /** Tabs withheld from this client (e.g. administrator-only sections for a collaborator). */
    hiddenTabs?: readonly SettingsTab[];
  }

  let { activeTab, onSelect, agentsNavigation, hiddenTabs = [] }: Props = $props();

  const groups = SETTINGS_NAV_GROUPS;
</script>

<nav
  class="flex min-h-0 w-full flex-1 flex-col gap-4 overflow-y-auto px-3 pt-1 pb-5"
  aria-label={m.settings_page_title()}
>
  {#each groups as group (group.id)}
    {@const groupItems = group.items.filter((item) => !hiddenTabs.includes(item.id))}
    {#if groupItems.length > 0}
      <section aria-labelledby={`settings-group-${group.id}`}>
        <h2
          id={`settings-group-${group.id}`}
          class="px-3 type-caption font-normal text-muted-foreground"
        >
          {group.label}
        </h2>
        <div class="mt-2 flex flex-col gap-px">
          {#each groupItems as item (item.id)}
            <Button
              variant="plain"
              type="button"
              onclick={() => onSelect(item.id)}
              active={activeTab === item.id}
              aria-current={activeTab === item.id ? 'page' : undefined}
              data-settings-tab={item.id}
              class="h-auto w-full justify-start rounded-lg p-0 text-left type-caption font-normal hover:bg-hover active:bg-active {activeTab ===
              item.id
                ? 'bg-foreground/5 text-foreground'
                : 'text-muted-foreground'}"
            >
              <ListRow
                class="min-h-8 w-full items-center gap-2 px-3 py-0 [&>[data-slot=list-row-leading]]:self-center"
              >
                {#snippet leading()}
                  <span
                    data-slot="settings-sidebar-icon"
                    class="flex size-4 shrink-0 items-center justify-center"
                  >
                    <item.icon size={16} weight="regular" aria-hidden="true" />
                  </span>
                {/snippet}
                {#snippet title()}
                  <span data-settings-sidebar-label class="block truncate type-body font-normal">
                    {item.label}
                  </span>
                {/snippet}
              </ListRow>
            </Button>
          {/each}
        </div>
      </section>
    {/if}
  {/each}
  <section
    data-settings-agents-section
    data-settings-specialists-section
    aria-labelledby="settings-group-specialists"
  >
    <h2 id="settings-group-specialists" class="px-3 type-caption font-normal text-muted-foreground">
      {m.settings_sidebar_specialists_label()}
    </h2>
    <div class="mt-2 flex flex-col gap-px">
      {@render agentsNavigation()}
    </div>
  </section>
</nav>
