<script lang="ts">
  /**
   * Settings › Machines section for the machine rail (Labs): which saved
   * machines this window keeps in its rail. One switch per machine; main owns
   * the list, so a switch only sends a request and reflects main's state.
   */
  import { SettingsForm, defineSettings } from '$lib/components/patterns/settings';
  import { formatConnectionLabel, formatLocalMachineLabel } from '$lib/utils/connection-label';
  import { m } from '$shared/paraglide/messages.js';
  import {
    selectMachineRailEnabled,
    selectMachineRailSettingsRows,
  } from '$store/renderer/slices/machine-rail/machine-rail-selectors';
  import {
    addRailMachineRequested,
    removeRailMachineRequested,
  } from '$store/renderer/slices/machine-rail/machine-rail-slice';
  import { store as appStore } from '$store/renderer/store';

  const enabled$ = selectMachineRailEnabled();
  const rows$ = selectMachineRailSettingsRows();

  const schema = $derived(
    defineSettings({
      sections: [
        {
          id: 'machine-rail',
          title: m.machineRail_settings_title(),
          description: m.machineRail_settings_description(),
          entries: $rows$.map((row) => ({
            kind: 'switch' as const,
            id: `machine-rail-${row.record.id}`,
            size: 'sm' as const,
            label: row.record.isLocal
              ? formatLocalMachineLabel(row.record)
              : formatConnectionLabel(row.record),
            description: row.home ? m.machineRail_settings_home_description() : undefined,
            disabled: row.home,
            get: () => row.inRail,
            set: (next: boolean) => {
              appStore.dispatch(
                next
                  ? addRailMachineRequested(row.record.id)
                  : removeRailMachineRequested(row.record.id),
              );
            },
          })),
        },
      ],
    }),
  );
</script>

{#if $enabled$ && $rows$.length > 0}
  <div data-testid="machine-rail-settings">
    <SettingsForm {schema} compact={false} />
  </div>
{/if}
