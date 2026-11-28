<script lang="ts">
  import { Badge } from '$lib/components/ui/badge';
  import type { RemoteMachine } from '$shared/types/remote-machines';
  import { remoteMachineProblem } from './remote-machines-messages';

  let { machine }: { machine: RemoteMachine } = $props();
  const badge = $derived(remoteMachineProblem(machine));
</script>

{#if badge}
  <Badge variant="dot" color={badge.color}>{badge.label}</Badge>
{/if}
