<script lang="ts">
  import Fa from 'svelte-fa';
  import { SettingsFieldRow } from '$lib/components/patterns/settings';
  import * as ToggleGroup from '$lib/components/ui/toggle-group';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import {
    HIDEABLE_TAB_IDS,
    TAB_DEFINITIONS,
  } from '$lib/components/workspace/multi-select-sidebar-tabs';
  import { selectHiddenSidebarTabIds } from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';
  import { setSidebarTabHidden } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';

  const hidden$ = selectHiddenSidebarTabIds();
  const tabs = TAB_DEFINITIONS.filter(({ id }) => HIDEABLE_TAB_IDS.has(id));
  const shown = $derived(tabs.map(({ id }) => id).filter((id) => !$hidden$.includes(id)));

  function setShown(next: string[]) {
    for (const { id } of tabs) {
      const hide = !next.includes(id);
      if (hide !== $hidden$.includes(id)) appStore.dispatch(setSidebarTabHidden(id, hide));
    }
  }
</script>

<SettingsFieldRow
  id="sidebar-icons-field"
  label={m.settings_sidebarIcons_label()}
  description={m.settings_sidebarIcons_description()}
>
  <ToggleGroup.Root
    variant="outline"
    type="multiple"
    bind:value={() => shown, (value) => setShown(value as string[])}
    size="sm"
    aria-label={m.settings_sidebarIcons_label()}
    class="shrink-0"
  >
    {#each tabs as tab (tab.id)}
      <Tooltip content={tab.label} delayDuration={400}>
        <ToggleGroup.Item value={tab.id} aria-label={tab.label} data-sidebar-icon-toggle={tab.id}>
          <Fa icon={tab.icon} class="size-3.5" />
        </ToggleGroup.Item>
      </Tooltip>
    {/each}
  </ToggleGroup.Root>
</SettingsFieldRow>
