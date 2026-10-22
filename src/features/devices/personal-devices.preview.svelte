<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { setupPersonalDevicesFixture as setup } from '../../test/personal-devices-preview';
  export const preview = definePreview({
    id: 'personal-devices',
    title: 'Mobile pairing',
    defaultState: 'member',
    states: {
      member: { props: { role: 'member' }, setup: () => setup('member') },
      guest: { props: { role: 'guest' }, setup: () => setup('guest') },
      'owner-no-profile': { props: { role: 'owner' }, setup: () => setup('owner') },
    },
    captureReadiness: { selector: 'button:not(:disabled)' },
  });
</script>

<script lang="ts">
  import MobileSettings from '$features/settings/MobileSettings.svelte';
  import { selectPrincipalSnapshot } from '$store/renderer/slices/principal/principal-selectors';
  import { selectCurrentConnectionId } from '$store/renderer/slices/connections/connections-selectors';
  import type { HostRole } from '$shared/types/principal';
  let { role = 'member' }: { role?: HostRole } = $props();
  const principal$ = selectPrincipalSnapshot();
  const connectionId$ = selectCurrentConnectionId();
</script>

<div class="w-full min-w-0 bg-background p-6 text-foreground">
  {#if $principal$?.principal.hostRole === role && $connectionId$ === 'preview-host'}
    <MobileSettings />
  {/if}
</div>
