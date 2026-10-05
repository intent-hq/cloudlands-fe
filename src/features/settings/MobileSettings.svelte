<script lang="ts">
  import WebSocketApiSettings from '$lib/components/settings/WebSocketApiSettings.svelte';
  import { selectCurrentConnectionId } from '$store/renderer/slices/connections/connections-selectors';
  import { selectHostAdministrationDenied } from '$store/renderer/slices/principal/principal-selectors';
  import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
  import PersonalDevices from '$features/devices/PersonalDevices.svelte';

  const connectionId$ = selectCurrentConnectionId();
  const denied$ = selectHostAdministrationDenied();
</script>

{#key $connectionId$}
  <div class="space-y-6">
    <WebSocketApiSettings mobileOnly={$connectionId$ !== LOCAL_CONNECTION_ID} active={!$denied$} />
    <PersonalDevices />
  </div>
{/key}
