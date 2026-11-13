<script lang="ts">
  import { Badge } from '$lib/components/ui/badge';
  import type { RemoteMachine } from '$shared/types/remote-machines';
  import { remoteMachineBadge } from './remote-machines-messages';

  let {
    machine,
    backendLabel,
    exceptionsOnly = false,
  }: {
    machine: RemoteMachine;
    backendLabel: string;
    /** In the ordered "Where … runs agents" list: no pill while the machine can run agents. */
    exceptionsOnly?: boolean;
  } = $props();
  const badge = $derived(remoteMachineBadge(machine, backendLabel));
</script>

{#if !exceptionsOnly || badge.color !== 'green'}
  <Badge variant="dot" color={badge.color}>{badge.label}</Badge>
{/if}
