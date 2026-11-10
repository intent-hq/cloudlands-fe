<script lang="ts">
  import Fa from 'svelte-fa';
  import { faUsers } from '@fortawesome/free-solid-svg-icons';
  import DeviceIcon from '$lib/components/DeviceIcon.svelte';
  import { CONNECTION_ACCENT_CLASSES } from '$lib/utils/connection-accents';
  import { cn } from '$lib/utils';
  import type { UnifiedMachine } from '../unified-machines';

  interface Props {
    machine: UnifiedMachine;
    class?: string;
  }

  let { machine, class: className = '' }: Props = $props();
</script>

<!-- Decorative: callers put the machine name in the row's accessible label. -->
<span
  class={cn('flex size-3 shrink-0 items-center justify-center', className)}
  aria-hidden="true"
  data-unified-machine-marker={machine.id}
>
  {#if machine.kind === 'guest'}
    <Fa icon={faUsers} class="size-3!" />
  {:else if machine.accent}
    <span class={cn('size-2 rounded-full', CONNECTION_ACCENT_CLASSES[machine.accent])}></span>
  {:else}
    <DeviceIcon record={machine.icon} size={12} />
  {/if}
</span>
