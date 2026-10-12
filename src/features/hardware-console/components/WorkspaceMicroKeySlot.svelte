<script lang="ts">
  import { toStore } from 'svelte/store';
  import { microConnectedReadable } from '../device/connection-status';
  import { selectWorkspaceResolvedKeySlot } from '$store/renderer/slices/hardware-console/hardware-console-selectors';
  import MicroKeySlotSquare from './MicroKeySlotSquare.svelte';

  let { workspaceId, size = 'default' }: { workspaceId: string; size?: 'default' | 'compact' } =
    $props();
  const connected$ = microConnectedReadable();
  const slot$ = selectWorkspaceResolvedKeySlot(toStore(() => workspaceId));
</script>

{#if $connected$ && $slot$ !== null}
  <MicroKeySlotSquare slot={$slot$} {size} />
{/if}
