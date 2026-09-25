<script lang="ts">
  import { SettingsForm, defineSettings } from '$lib/components/patterns/settings';
  import { m } from '$shared/paraglide/messages.js';
  import { selectReduceMotionOnBattery } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import { setReduceMotionOnBattery } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import { store as appStore } from '$store/renderer/store';

  const reduceMotionOnBattery = selectReduceMotionOnBattery();
  const schema = $derived(
    defineSettings({
      sections: [
        {
          id: 'reduce-motion-on-battery',
          title: m.settings_appearance_reduceMotionOnBattery_label(),
          entries: [
            {
              kind: 'switch',
              id: 'reduce-motion-on-battery-switch',
              size: 'sm',
              label: m.settings_appearance_reduceMotionOnBattery_label(),
              description: m.settings_appearance_reduceMotionOnBattery_description(),
              get: () => $reduceMotionOnBattery,
              set: (enabled) => {
                appStore.dispatch(setReduceMotionOnBattery(enabled));
              },
            },
          ],
        },
      ],
    }),
  );
</script>

<SettingsForm {schema} embedded compact={false} />
