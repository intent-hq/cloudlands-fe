<script lang="ts">
  import { SettingsForm, defineSettings } from '$lib/components/patterns/settings';
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
  const schema = $derived(
    defineSettings({
      sections: [
        {
          id: 'sidebar-icons',
          title: m.settings_sidebarIcons_label(),
          entries: tabs.map((tab) => ({
            kind: 'switch' as const,
            id: `sidebar-icon-${tab.id}`,
            size: 'sm' as const,
            label: tab.label,
            get: () => !$hidden$.includes(tab.id),
            set: (shown: boolean) => {
              appStore.dispatch(setSidebarTabHidden(tab.id, !shown));
            },
          })),
        },
      ],
    }),
  );
</script>

<SettingsForm {schema} embedded compact={false} />
