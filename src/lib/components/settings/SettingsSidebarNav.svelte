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

  const groups = [
    {
      get label() {
        return m.settings_sidebar_groupSettings_label();
      },
      items: [
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
      ],
    },
    {
      get label() {
        return m.settings_sidebar_groupAi_label();
      },
      items: [
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
      ],
    },
    {
      get label() {
        return m.settings_sidebar_groupWorkspace_label();
      },
      items: [
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
      ],
    },
    {
      get label() {
        return m.settings_sidebar_groupAdvanced_label();
      },
      items: [
        {
          id: 'advanced',
          icon: faGlobe,
          get label() {
            return m.settings_sidebar_advanced_label();
          },
        },
      ],
    },
  ];
</script>

<nav
  class="flex min-h-0 w-full flex-1 flex-col gap-5 overflow-y-auto px-3 py-4"
  aria-label={m.settings_page_title()}
>
  {#each groups as group (group.label)}
    <section>
      <h2
        class="mb-1.5 px-2.5 text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground/70"
      >
        {group.label}
      </h2>
      <div class="flex flex-col gap-0.5">
        {#each group.items as item (item.id)}
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
            <span class="flex w-4 shrink-0 justify-center opacity-75">
              <Fa icon={item.icon} size="xs" />
            </span>
            <span>{item.label}</span>
          </button>
        {/each}
      </div>
    </section>
  {/each}
</nav>
