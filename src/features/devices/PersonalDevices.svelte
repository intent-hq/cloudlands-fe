<script lang="ts">
  import { selectPersonalDevicesContext } from './personal-devices-selectors';
  import PersonalDevicesPanel from './PersonalDevicesPanel.svelte';
  const context$ = selectPersonalDevicesContext();
</script>

{#if $context$}
  {#key $context$}<PersonalDevicesPanel context={$context$} />{/key}
{/if}
