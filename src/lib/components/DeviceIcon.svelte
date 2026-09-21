<script lang="ts">
  import { cn } from '$lib/utils';
  import {
    DEVICE_ICON_REGISTRY,
    resolveDeviceKind,
    type DeviceIconSource,
  } from '$lib/utils/device-icons';

  interface Props {
    record: DeviceIconSource;
    size?: number | string;
    class?: string;
    /** Accessible name for standalone use; omit when adjacent text already labels the icon. */
    label?: string;
  }

  let { record, size = 16, class: className = '', label }: Props = $props();
  const kind = $derived(resolveDeviceKind(record));
  const Icon = $derived(DEVICE_ICON_REGISTRY[kind].icon);
</script>

<Icon
  {size}
  class={cn('shrink-0', className)}
  role={label === undefined ? undefined : 'img'}
  aria-label={label}
  aria-hidden={label === undefined ? 'true' : undefined}
/>
