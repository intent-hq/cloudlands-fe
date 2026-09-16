<script lang="ts">
  import { ListRow } from '$lib/components/patterns/collection';
  import { Button } from '$lib/components/patterns/settings/custom-controls';
  import { m } from '$shared/paraglide/messages.js';
  import {
    faCodeBranch,
    faGlobe,
    faKeyboard,
    faServer,
    faPlug,
    faRobot,
    faSliders,
    faTerminal,
    faWandMagicSparkles,
  } from '@fortawesome/free-solid-svg-icons';
  import type { Snippet } from 'svelte';
  import type { SettingsTab } from '$lib/components/patterns/settings/types';
  import Fa from 'svelte-fa';

  interface Props {
    activeTab: SettingsTab;
    onSelect: (tab: SettingsTab) => void;
    agentsNavigation: Snippet;
  }

  let { activeTab, onSelect, agentsNavigation }: Props = $props();

  const groups = [
    {
      id: 'preferences',
      get label() {
        return m.settings_sidebar_preferences_label();
      },
    },
    {
      id: 'agents',
      get label() {
        return m.settings_sidebar_agents_label();
      },
    },
    {
      id: 'integrations',
      get label() {
        return m.settings_sidebar_integrations_label();
      },
    },
    {
      id: 'environment',
      get label() {
        return m.settings_sidebar_environment_label();
      },
    },
    {
      id: 'troubleshooting',
      get label() {
        return m.settings_sidebar_troubleshooting_label();
      },
    },
  ];

  const primaryItems = [
    {
      id: 'display',
      group: 'preferences',
      icon: faWandMagicSparkles,
      get label() {
        return m.settings_sidebar_display_label();
      },
    },
    {
      id: 'app-behavior',
      group: 'preferences',
      icon: faSliders,
      get label() {
        return m.settings_sidebar_appBehavior_label();
      },
    },
    {
      id: 'agent-behavior',
      group: 'agents',
      icon: faRobot,
      get label() {
        return m.settings_sidebar_agentBehavior_label();
      },
    },
    {
      id: 'providers',
      group: 'integrations',
      icon: faTerminal,
      get label() {
        return m.settings_sidebar_providers_label();
      },
    },
    {
      id: 'connections',
      group: 'integrations',
      icon: faPlug,
      get label() {
        return m.settings_sidebar_connections_label();
      },
    },
    {
      id: 'devices',
      group: 'environment',
      icon: faServer,
      get label() {
        return m.settings_sidebar_devices_label();
      },
    },
    {
      id: 'setup',
      group: 'environment',
      icon: faCodeBranch,
      get label() {
        return m.settings_sidebar_setup_label();
      },
    },
    {
      id: 'input',
      group: 'preferences',
      icon: faKeyboard,
      get label() {
        return m.settings_sidebar_input_label();
      },
    },
    {
      id: 'advanced',
      group: 'troubleshooting',
      icon: faGlobe,
      get label() {
        return m.settings_sidebar_advanced_label();
      },
    },
  ];
</script>

<nav
  class="flex min-h-0 w-full flex-1 flex-col gap-4 overflow-y-auto px-3 py-4"
  aria-label={m.settings_page_title()}
>
  {#each groups as group (group.id)}
    <section aria-labelledby={`settings-group-${group.id}`}>
      <h2
        id={`settings-group-${group.id}`}
        class="mb-2 px-2.5 type-caption font-semibold text-muted-foreground"
      >
        {group.label}
      </h2>
      <div class="flex flex-col gap-0.5">
        {#each primaryItems.filter((item) => item.group === group.id) as item (item.id)}
          <Button
            variant="ghost"
            type="button"
            onclick={() => onSelect(item.id as SettingsTab)}
            active={activeTab === item.id}
            aria-current={activeTab === item.id ? 'page' : undefined}
            data-settings-tab={item.id}
            class="h-auto w-full justify-start p-0 text-left type-caption {activeTab === item.id
              ? 'bg-muted font-medium text-foreground shadow-xs'
              : 'text-muted-foreground'}"
          >
            <ListRow class="min-h-(--row-height-regular) w-full gap-2.5 px-2.5 py-0">
              {#snippet leading()}
                <span
                  data-slot="settings-sidebar-icon"
                  class="flex size-4 shrink-0 items-center justify-center opacity-75"
                >
                  <Fa icon={item.icon} size="sm" />
                </span>
              {/snippet}
              {#snippet title()}{item.label}{/snippet}
            </ListRow>
          </Button>
        {/each}
      </div>
      {#if group.id === 'agents'}
        <section data-settings-agents-section data-settings-specialists-section class="mt-2">
          <h3 class="px-2.5 type-caption font-semibold text-muted-foreground">
            {m.settings_sidebar_specialists_label()}
          </h3>
          <div class="mt-2 flex flex-col gap-0.5 [&_[data-settings-agent-row]]:justify-start">
            {@render agentsNavigation()}
          </div>
        </section>
      {/if}
    </section>
  {/each}
</nav>
