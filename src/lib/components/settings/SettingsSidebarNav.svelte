<script lang="ts">
  import { ListRow } from '$lib/components/patterns/collection';
  import { Button } from '$lib/components/patterns/settings/custom-controls';
  import { m } from '$shared/paraglide/messages.js';
  import DevicesIcon from 'phosphor-svelte/lib/DevicesIcon';
  import GearSixIcon from 'phosphor-svelte/lib/GearSixIcon';
  import GitBranchIcon from 'phosphor-svelte/lib/GitBranchIcon';
  import KeyboardIcon from 'phosphor-svelte/lib/KeyboardIcon';
  import PaintBrushIcon from 'phosphor-svelte/lib/PaintBrushIcon';
  import PlugsConnectedIcon from 'phosphor-svelte/lib/PlugsConnectedIcon';
  import RobotIcon from 'phosphor-svelte/lib/RobotIcon';
  import SlidersHorizontalIcon from 'phosphor-svelte/lib/SlidersHorizontalIcon';
  import TerminalWindowIcon from 'phosphor-svelte/lib/TerminalWindowIcon';
  import UsersIcon from 'phosphor-svelte/lib/UsersIcon';
  import type { Snippet } from 'svelte';
  import type { SettingsTab } from '$lib/components/patterns/settings/types';

  interface Props {
    activeTab: SettingsTab;
    onSelect: (tab: SettingsTab) => void;
    agentsNavigation: Snippet;
    /** Tabs withheld from this client (e.g. administrator-only sections for a collaborator). */
    hiddenTabs?: readonly SettingsTab[];
  }

  let { activeTab, onSelect, agentsNavigation, hiddenTabs = [] }: Props = $props();

  const primaryItems = [
    {
      id: 'display',
      icon: PaintBrushIcon,
      get label() {
        return m.settings_sidebar_display_label();
      },
    },
    {
      id: 'app-behavior',
      icon: SlidersHorizontalIcon,
      get label() {
        return m.settings_sidebar_appBehavior_label();
      },
    },
    {
      id: 'input',
      icon: KeyboardIcon,
      get label() {
        return m.settings_sidebar_input_label();
      },
    },
    {
      id: 'agent-behavior',
      icon: RobotIcon,
      get label() {
        return m.settings_sidebar_agentBehavior_label();
      },
    },
    {
      id: 'providers',
      icon: TerminalWindowIcon,
      get label() {
        return m.settings_sidebar_providers_label();
      },
    },
    {
      id: 'connections',
      icon: PlugsConnectedIcon,
      get label() {
        return m.settings_sidebar_connections_label();
      },
    },
    {
      id: 'devices',
      icon: DevicesIcon,
      get label() {
        return m.settings_sidebar_devices_label();
      },
    },
    {
      id: 'guest-sessions',
      icon: UsersIcon,
      get label() {
        return m.settings_sidebar_guestSessions_label();
      },
    },
    {
      id: 'setup',
      icon: GitBranchIcon,
      get label() {
        return m.settings_sidebar_setup_label();
      },
    },
    {
      id: 'advanced',
      icon: GearSixIcon,
      get label() {
        return m.settings_sidebar_advanced_label();
      },
    },
  ];

  const groups = [
    {
      id: 'preferences',
      get label() {
        return m.settings_sidebar_preferences_label();
      },
      items: primaryItems.slice(0, 3),
    },
    {
      id: 'environment',
      get label() {
        return m.settings_sidebar_environment_label();
      },
      items: primaryItems.slice(5),
    },
    {
      id: 'agents',
      get label() {
        return m.settings_sidebar_agents_label();
      },
      items: primaryItems.slice(3, 5),
    },
  ];
</script>

<nav
  class="flex min-h-0 w-full flex-1 flex-col gap-4 overflow-y-auto px-3 pt-1 pb-5"
  aria-label={m.settings_page_title()}
>
  {#each groups as group (group.id)}
    {@const groupItems = group.items.filter((item) => !hiddenTabs.includes(item.id as SettingsTab))}
    {#if groupItems.length > 0}
      <section aria-labelledby={`settings-group-${group.id}`}>
        <h2
          id={`settings-group-${group.id}`}
          class="px-3 type-caption font-normal text-muted-foreground"
        >
          {group.label}
        </h2>
        <div class="mt-2 flex flex-col">
          {#each groupItems as item (item.id)}
            <Button
              variant="plain"
              type="button"
              onclick={() => onSelect(item.id as SettingsTab)}
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
    <div class="mt-2 flex flex-col">
      {@render agentsNavigation()}
    </div>
  </section>
</nav>
