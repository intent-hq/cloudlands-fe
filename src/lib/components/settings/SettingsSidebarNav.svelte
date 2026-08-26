<script lang="ts">
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
  import Fa from 'svelte-fa';

  type SettingsTab =
    | 'display'
    | 'app-behavior'
    | 'agent-behavior'
    | 'providers'
    | 'connections'
    | 'machines'
    | 'setup'
    | 'advanced'
    | 'input'
    | 'specialists';

  interface Props {
    activeTab: SettingsTab;
    onSelect: (tab: SettingsTab) => void;
    agentsNavigation: Snippet;
  }

  let { activeTab, onSelect, agentsNavigation }: Props = $props();

  const primaryItems = [
    {
      id: 'display',
      icon: faWandMagicSparkles,
      get label() {
        return m.settings_sidebar_display_label();
      },
    },
    {
      id: 'app-behavior',
      icon: faSliders,
      get label() {
        return m.settings_sidebar_appBehavior_label();
      },
    },
    {
      id: 'agent-behavior',
      icon: faRobot,
      get label() {
        return m.settings_sidebar_agentBehavior_label();
      },
    },
    {
      id: 'providers',
      icon: faTerminal,
      get label() {
        return m.settings_sidebar_providers_label();
      },
    },
    {
      id: 'connections',
      icon: faPlug,
      get label() {
        return m.settings_sidebar_connections_label();
      },
    },
    {
      id: 'machines',
      icon: faServer,
      get label() {
        return m.settings_sidebar_machines_label();
      },
    },
    {
      id: 'setup',
      icon: faCodeBranch,
      get label() {
        return m.settings_sidebar_setup_label();
      },
    },
    {
      id: 'input',
      icon: faKeyboard,
      get label() {
        return m.settings_sidebar_input_label();
      },
    },
    {
      id: 'advanced',
      icon: faGlobe,
      get label() {
        return m.settings_sidebar_advanced_label();
      },
    },
  ];
</script>

<nav
  class="flex min-h-0 w-full flex-1 flex-col gap-0 overflow-y-auto px-3 py-4"
  aria-label={m.settings_page_title()}
>
  {#each primaryItems as item (item.id)}
    <button
      type="button"
      onclick={() => onSelect(item.id as SettingsTab)}
      aria-current={activeTab === item.id ? 'page' : undefined}
      data-settings-tab={item.id}
      class="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring
        {item.id === 'advanced' ? '' : 'mb-0.5'}
        {activeTab === item.id
        ? 'bg-muted font-medium text-foreground shadow-xs'
        : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'}"
    >
      <span
        data-slot="settings-sidebar-icon"
        class="flex size-4 shrink-0 items-center justify-center opacity-75"
      >
        <Fa icon={item.icon} size="sm" />
      </span>
      <span>{item.label}</span>
    </button>
  {/each}

  <section data-settings-agents-section data-settings-specialists-section class="mt-8">
    <h2 class="type-caption font-semibold uppercase text-muted-foreground tracking-wider">
      {m.settings_sidebar_specialists_label()}
    </h2>
    <div class="flex flex-col gap-0.5 mt-2">
      {@render agentsNavigation()}
    </div>
  </section>
</nav>
