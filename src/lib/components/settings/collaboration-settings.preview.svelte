<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { setupCollaborationSettingsPreview as setup } from './collaboration-settings.preview-fixtures';

  export const preview = definePreview({
    id: 'collaboration-settings',
    title: 'Collaboration settings',
    defaultState: 'owner-empty',
    states: {
      'owner-empty': { props: {}, setup: () => setup('owner') },
      'owner-populated': { props: {}, setup: () => setup('owner', true) },
      member: { props: {}, setup: () => setup('member', true) },
      unknown: { props: {}, setup: () => setup(null) },
      disabled: { props: {}, setup: () => setup('owner', false, false) },
    },
  });
</script>

<script lang="ts">
  import GuestSessionsSettings from './GuestSessionsSettings.svelte';
</script>

<div class="w-full min-w-0 bg-background p-6 text-foreground">
  <GuestSessionsSettings />
</div>
