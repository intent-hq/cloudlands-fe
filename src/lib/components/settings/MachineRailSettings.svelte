<script lang="ts">
  import { SettingsForm, defineSettings } from '$lib/components/patterns/settings';
  import { m } from '$shared/paraglide/messages.js';
  import { setMachineRailEnabledRequested } from '$store/renderer/slices/machine-rail/machine-rail-slice';
  import { selectMachineRailEnabled } from '$store/renderer/slices/machine-rail/machine-rail-selectors';
  import { store as appStore } from '$store/renderer/store';

  const machineRail$ = selectMachineRailEnabled();
  const schema = $derived(
    defineSettings({
      sections: [
        {
          id: 'machine-rail',
          title: m.settings_machineRail_label(),
          entries: [
            {
              kind: 'switch',
              id: 'machine-rail-switch',
              size: 'sm',
              label: m.settings_machineRail_label(),
              description: m.settings_machineRail_description(),
              get: () => $machineRail$,
              set: (enabled) => {
                appStore.dispatch(setMachineRailEnabledRequested(enabled));
              },
            },
          ],
        },
      ],
    }),
  );
</script>

<SettingsForm {schema} embedded compact={false} />
