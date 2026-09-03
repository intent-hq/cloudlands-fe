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
  }

  let { record, size = 16, class: className = '' }: Props = $props();
  const kind = $derived(resolveDeviceKind(record));
  const Icon = $derived(DEVICE_ICON_REGISTRY[kind].icon);
</script>

<Icon {size} class={cn('shrink-0', className)} aria-hidden="true" />
