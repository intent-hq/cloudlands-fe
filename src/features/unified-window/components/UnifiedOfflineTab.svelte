<script lang="ts">
  import Fa from 'svelte-fa';
  import { faUsers } from '@fortawesome/free-solid-svg-icons';
  import DeviceIcon from '$lib/components/DeviceIcon.svelte';
  import { EmptyState } from '$lib/components/patterns/screen';
  import { m } from '$shared/paraglide/messages.js';
  import type { UnifiedMachine } from '../unified-machines';

  interface Props {
    machine: UnifiedMachine;
  }

  let { machine }: Props = $props();
</script>

<EmptyState class="h-full" data-unified-offline-tab={machine.id}>
  {#snippet icon()}
    <span class="text-muted-foreground">
      {#if machine.kind === 'guest'}
        <Fa icon={faUsers} class="size-6!" />
      {:else}
        <DeviceIcon record={machine.icon} size={24} />
      {/if}
    </span>
  {/snippet}
  {#snippet title()}<h2>{m.unifiedWindow_offline_title({ machine: machine.label })}</h2>{/snippet}
  {#snippet description()}<p>{m.unifiedWindow_offline_description()}</p>{/snippet}
</EmptyState>
