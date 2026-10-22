<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { setupCollaborationSettingsPreview as setup } from './collaboration-settings.preview-fixtures';

  export const preview = definePreview({
    id: 'collaboration-settings',
    title: 'Collaboration settings',
    defaultState: 'owner-empty',
    states: {
      'mixed-sharing': { props: {}, setup: () => setup('owner', true, true, false, 'ready', true) },
      'owner-empty': { props: {}, setup: () => setup('owner') },
      'owner-status-loading': {
        props: {},
        setup: () => setup('owner', true, true, false, 'loading'),
      },
      'owner-status-error': { props: {}, setup: () => setup('owner', true, true, false, 'error') },
      'owner-populated': { props: {}, setup: () => setup('owner', true) },
      'remote-member': { props: {}, setup: () => setup('member', true, true, true) },
      'remote-empty': { props: {}, setup: () => setup('member', false, true, true) },
      'remote-unknown': { props: {}, setup: () => setup(null, false, true, true) },
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
