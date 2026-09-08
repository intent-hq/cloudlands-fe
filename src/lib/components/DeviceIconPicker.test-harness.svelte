<script lang="ts">
  import type { DeviceIconChoice } from '$shared/types/connections';
  import DeviceIconPicker from './DeviceIconPicker.svelte';

  let value = $state<DeviceIconChoice | undefined>(undefined);
</script>

<DeviceIconPicker
  record={{ deviceIcon: 'cat', detectedDeviceKind: 'laptop' }}
  bind:value
  portal={false}
/>

<output data-testid="bound-device-icon-value">{value ?? 'undefined'}</output>
