<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { setupPersonalDevicesFixture as setup } from '../../test/personal-devices-preview';
  export const preview = definePreview({
    id: 'personal-devices',
    title: 'Personal devices',
    defaultState: 'member',
    states: {
      member: { props: {}, setup: () => setup('member') },
      guest: { props: {}, setup: () => setup('guest') },
      'owner-no-profile': { props: {}, setup: () => setup('owner') },
    },
    captureReadiness: { selector: '[data-personal-devices-ready=true]' },
  });
</script>

<script lang="ts">
  import PersonalDevices from './PersonalDevices.svelte';
</script>

<div class="w-full min-w-0 bg-background p-6 text-foreground"><PersonalDevices /></div>
