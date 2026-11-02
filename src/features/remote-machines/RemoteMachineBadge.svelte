<script lang="ts">
  import { Badge } from '$lib/components/ui/badge';
  import type { RemoteMachine } from '$shared/types/remote-machines';
  import { remoteMachineBadge } from './remote-machines-messages';

  let { machine, backendLabel }: { machine: RemoteMachine; backendLabel: string } = $props();
  const badge = $derived(remoteMachineBadge(machine, backendLabel));
</script>

<Badge variant="dot" color={badge.color}>{badge.label}</Badge>
