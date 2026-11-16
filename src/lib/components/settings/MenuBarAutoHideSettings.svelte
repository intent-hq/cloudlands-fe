<script lang="ts">
  import { SettingsForm, defineSettings } from '$lib/components/patterns/settings';
  import { m } from '$shared/paraglide/messages.js';
  import { selectMenuBarAutoHide } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import { setMenuBarAutoHide } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import { store as appStore } from '$store/renderer/store';

  const menuBarAutoHide = selectMenuBarAutoHide();
  const schema = $derived(
    defineSettings({
      sections: [
        {
          id: 'menu-bar-auto-hide',
          title: m.settings_appearance_menuBarAutoHide_label(),
          entries: [
            {
              kind: 'switch',
              id: 'menu-bar-auto-hide-switch',
              size: 'sm',
              label: m.settings_appearance_menuBarAutoHide_label(),
              description: m.settings_appearance_menuBarAutoHide_description(),
              get: () => $menuBarAutoHide,
              set: (enabled) => {
                appStore.dispatch(setMenuBarAutoHide(enabled));
              },
            },
          ],
        },
      ],
    }),
  );
</script>

<SettingsForm {schema} embedded compact={false} />
