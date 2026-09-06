<script lang="ts">
  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import { faTriangleExclamation } from '$lib/icons/phosphor-icons';
  import { m } from '$shared/paraglide/messages.js';
  import type { DaemonHostRepairTarget } from '$store/renderer/slices/daemon-health/daemon-health-types';
  import type { ControllerState } from '../controller';
  import { formatDaemonHostRepairTarget } from './host-repair-target';

  interface Props {
    capabilities: ControllerState['capabilities'];
    host?: DaemonHostRepairTarget;
    onRecheck?: () => void;
  }

  let { capabilities, host, onRecheck }: Props = $props();

  const items = $derived([
    { id: 'git' as const, name: 'Git', status: capabilities.git },
    { id: 'node' as const, name: 'Node.js', status: capabilities.node },
    { id: 'github' as const, name: 'GitHub', status: capabilities.github },
  ]);

  onMount(() => {
    if (!onRecheck) return;
    const handleFocus = () => onRecheck?.();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') onRecheck?.();
    };
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  });
</script>

<div class="grid gap-2" aria-label={m.newWorkspace_capabilities_ariaLabel()}>
  {#each items.filter((item) => item.status === 'missing') as item (item.id)}
    <div
      class="type-caption flex items-start gap-2 py-2 text-muted-foreground"
      data-capability={item.id}
      data-status={item.status}
      data-capability-guidance={item.id}
    >
      <Fa icon={faTriangleExclamation} class="mt-0.5 shrink-0 text-warning" />
      <span>
        {m.newWorkspace_capabilities_repairOnHost_description({
          capability: item.name,
          host: formatDaemonHostRepairTarget(host),
        })}
      </span>
    </div>
  {/each}
</div>
