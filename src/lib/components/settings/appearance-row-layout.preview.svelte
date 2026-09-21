<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  export const preview = definePreview({
    id: 'appearance-row-layout',
    title: 'Appearance row alignment',
    defaultState: 'default',
    states: { default: { props: {} } },
  });
</script>

<script lang="ts">
  import { SettingsForm, defineSettings } from '$lib/components/patterns/settings';
  import ReduceMotionOnBatterySettings from './ReduceMotionOnBatterySettings.svelte';

  let referenceEnabled = $state(false);
  let stackedEnabled = $state(false);
  const referenceSchema = defineSettings({
    sections: [
      {
        id: 'reference-appearance',
        title: 'Reference appearance form',
        entries: [
          {
            kind: 'switch',
            id: 'reference-appearance-row',
            label: 'Neighboring appearance control',
            description:
              'A reference row with enough explanatory text to wrap naturally at narrow widths.',
            size: 'sm',
            get: () => referenceEnabled,
            set: (enabled) => {
              referenceEnabled = enabled;
            },
          },
        ],
      },
    ],
  });
  const schema = defineSettings({
    sections: [
      {
        id: 'stacked-default',
        title: 'Default form',
        entries: [
          {
            kind: 'switch',
            id: 'stacked-default-switch',
            label: 'Default stacked control',
            description: 'Other settings forms keep their existing layout.',
            get: () => stackedEnabled,
            set: (enabled) => {
              stackedEnabled = enabled;
            },
          },
        ],
      },
    ],
  });
</script>

<div class="w-full min-w-0 bg-background p-6 text-foreground" data-testid="appearance-rows">
  <SettingsForm schema={referenceSchema} embedded compact={false} />
  <ReduceMotionOnBatterySettings />
  <SettingsForm {schema} embedded />
</div>
