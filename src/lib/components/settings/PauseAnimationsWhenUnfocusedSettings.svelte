<script lang="ts">
  import { SettingsForm, defineSettings } from '$lib/components/patterns/settings';
  import { m } from '$shared/paraglide/messages.js';
  import { selectPauseAnimationsWhenUnfocused } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import { setPauseAnimationsWhenUnfocused } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import { store as appStore } from '$store/renderer/store';

  const pauseAnimationsWhenUnfocused = selectPauseAnimationsWhenUnfocused();
  const schema = $derived(
    defineSettings({
      sections: [
        {
          id: 'pause-animations-when-unfocused',
          title: m.settings_appearance_pauseAnimationsWhenUnfocused_label(),
          entries: [
            {
              kind: 'switch',
              id: 'pause-animations-when-unfocused-switch',
              size: 'sm',
              label: m.settings_appearance_pauseAnimationsWhenUnfocused_label(),
              description: m.settings_appearance_pauseAnimationsWhenUnfocused_description(),
              get: () => $pauseAnimationsWhenUnfocused,
              set: (enabled) => {
                appStore.dispatch(setPauseAnimationsWhenUnfocused(enabled));
              },
            },
          ],
        },
      ],
    }),
  );
</script>

<SettingsForm {schema} embedded compact={false} />
