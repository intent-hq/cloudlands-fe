<script lang="ts">
  import { m } from '$shared/paraglide/messages.js';

  type SettingsTab = 'accounts' | 'agents' | 'setup' | 'fonts-colors' | 'general';

  interface Props {
    activeTab: SettingsTab;
    onSelect: (tab: SettingsTab) => void;
  }

  let { activeTab, onSelect }: Props = $props();

  const items: { id: SettingsTab; label: string }[] = [
    { id: 'accounts', label: m.settings_tab_accounts() },
    { id: 'agents', label: m.settings_tab_agents() },
    { id: 'setup', label: m.settings_tab_setup() },
    { id: 'fonts-colors', label: m.settings_tab_fontsColors() },
    { id: 'general', label: m.settings_tab_general() },
  ];
</script>

<nav
  class="sticky top-6 flex w-full shrink-0 flex-col gap-1 self-start"
  aria-label={m.settings_page_title()}
>
  {#each items as item (item.id)}
    <button
      type="button"
      onclick={() => onSelect(item.id)}
      aria-current={activeTab === item.id ? 'page' : undefined}
      data-settings-tab={item.id}
      class="w-full cursor-pointer rounded-lg px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring
        {activeTab === item.id
        ? 'bg-muted font-medium text-foreground'
        : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'}"
    >
      {item.label}
    </button>
  {/each}
</nav>
