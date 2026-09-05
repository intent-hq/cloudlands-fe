<script lang="ts">
  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import {
    faCheck,
    faCircleNotch,
    faCircleQuestion,
    faTriangleExclamation,
  } from '$lib/icons/phosphor-icons';
  import { m } from '$shared/paraglide/messages.js';
  import type { DaemonHostRepairTarget } from '$store/renderer/slices/daemon-health/daemon-health-types';
  import type { CapabilityStatus, ControllerState } from '../controller';
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

  function statusLabel(status: CapabilityStatus): string {
    switch (status) {
      case 'pending':
        return m.newWorkspace_capabilities_pending_label();
      case 'ready':
        return m.newWorkspace_capabilities_ready_label();
      case 'missing':
        return m.newWorkspace_capabilities_missing_label();
      case 'unknown':
        return m.newWorkspace_capabilities_unknown_label();
    }
  }

  function iconFor(status: CapabilityStatus) {
    switch (status) {
      case 'pending':
        return faCircleNotch;
      case 'ready':
        return faCheck;
      case 'missing':
        return faTriangleExclamation;
      case 'unknown':
        return faCircleQuestion;
    }
  }

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

<section class="grid gap-2" aria-label={m.newWorkspace_capabilities_ariaLabel()}>
  <div class="grid grid-cols-3 gap-2">
    {#each items as item (item.id)}
      <div
        class="min-w-0 rounded-lg border border-border bg-background/70 px-2.5 py-2"
        data-capability={item.id}
        data-status={item.status}
      >
        <div class="flex items-center gap-1.5">
          <Fa
            icon={iconFor(item.status)}
            class="shrink-0 {item.status === 'pending'
              ? 'animate-spin motion-reduce:animate-none'
              : item.status === 'ready'
                ? 'text-success'
                : item.status === 'missing'
                  ? 'text-warning'
                  : ''}"
            size="sm"
          />
          <span class="truncate text-xs font-medium"
            ><!-- i18n-ignore (tool names) -->{item.name}</span
          >
        </div>
        <p class="mt-1 truncate text-[0.68rem] text-muted-foreground">
          {statusLabel(item.status)}
        </p>
      </div>
    {/each}
  </div>

  {#each items.filter((item) => item.status === 'missing') as item (item.id)}
    <p class="text-xs text-muted-foreground" data-capability-guidance={item.id}>
      {m.newWorkspace_capabilities_repairOnHost_description({
        capability: item.name,
        host: formatDaemonHostRepairTarget(host),
      })}
    </p>
  {/each}
</section>
