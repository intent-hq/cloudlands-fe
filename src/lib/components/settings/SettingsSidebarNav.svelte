<script lang="ts">
  import { m } from '$shared/paraglide/messages.js';
  import {
    faCodeBranch,
    faGear,
    faGlobe,
    faPlug,
    faRobot,
    faTerminal,
    faWandMagicSparkles,
    faWrench,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';

  type SettingsTab =
    | 'general'
    | 'appearance'
    | 'providers'
    | 'agents'
    | 'connections'
    | 'git-workspace'
    | 'tools'
    | 'advanced';

  interface Props {
    activeTab: SettingsTab;
    onSelect: (tab: SettingsTab) => void;
  }

  let { activeTab, onSelect }: Props = $props();

  const items = [
    {
      id: 'general',
      icon: faGear,
      get label() {
        return m.settings_sidebar_general_label();
      },
    },
    {
      id: 'appearance',
      icon: faWandMagicSparkles,
      get label() {
        return m.settings_sidebar_appearance_label();
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
      id: 'agents',
      icon: faRobot,
      get label() {
        return m.settings_sidebar_agents_label();
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
      id: 'git-workspace',
      icon: faCodeBranch,
      get label() {
        return m.settings_sidebar_gitWorkspace_label();
      },
    },
    {
      id: 'tools',
      icon: faWrench,
      get label() {
        return m.settings_sidebar_tools_label();
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
  class="flex min-h-0 w-full flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-4"
  aria-label={m.settings_page_title()}
>
  {#each items as item (item.id)}
    <button
      type="button"
      onclick={() => onSelect(item.id as SettingsTab)}
      aria-current={activeTab === item.id ? 'page' : undefined}
      data-settings-tab={item.id}
      class="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring
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
</nav>
