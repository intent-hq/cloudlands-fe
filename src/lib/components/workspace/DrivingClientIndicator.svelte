<script lang="ts">
  // Show agent activity and offline primary-client recovery, even without tabs.
  import { faGlobe } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { TooltipRich } from '$lib/components/ui/tooltip';
  import { m } from '$shared/paraglide/messages.js';
  import { resolveDrivingClientView, type DrivingClientInput } from './driving-indicator';

  type Props = DrivingClientInput;

  let { eligibleClients, ownClientId, driving, hasBrowserTabs, activeComputerName }: Props =
    $props();

  const view = $derived(
    resolveDrivingClientView({
      eligibleClients,
      ownClientId,
      driving,
      hasBrowserTabs,
      activeComputerName,
    }),
  );

  const label = $derived.by(() => {
    if (!view) return '';
    switch (view.mode) {
      case 'here':
        return m.workspace_drivingClient_here_label({ host: view.hostName });
      case 'elsewhere':
        return m.workspace_drivingClient_elsewhere_label({ host: view.hostName });
      case 'offline':
        return m.workspace_drivingClient_offline_label();
    }
  });

  const description = $derived.by(() => {
    if (!view) return '';
    if (activeComputerName)
      return m.desktop_primary_active_description({ computer: activeComputerName });
    switch (view.mode) {
      case 'here':
        return m.workspace_drivingClient_here_description();
      case 'elsewhere':
        return m.workspace_drivingClient_elsewhere_description({ host: view.hostName });
      case 'offline':
        return m.workspace_drivingClient_offline_description({ host: view.hostName });
    }
  });
</script>

{#if view}
  <TooltipRich
    side="bottom"
    align="start"
    sideOffset={6}
    delayDuration={300}
    maxWidth="18rem"
    title={label}
    {description}
    variant={view.mode === 'offline' ? 'warning' : 'default'}
    class="type-caption flex h-5 min-w-0 max-w-full cursor-default items-center gap-1.5 rounded-sm border-none bg-transparent p-0 text-left leading-5 text-muted-foreground"
  >
    {#snippet trigger()}
      <span
        class="flex h-5 min-w-0 items-center gap-1.5 leading-5"
        data-sidebar-driving-client={view.mode}
        aria-label={label}
      >
        <span class="relative flex shrink-0 items-center" aria-hidden="true">
          <Fa icon={faGlobe} size="xs" />
          <span
            class="absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full {view.mode === 'here'
              ? 'bg-success'
              : view.mode === 'offline'
                ? 'bg-danger'
                : 'bg-muted-foreground/60'}"
          ></span>
        </span>
        <span class="min-w-0 truncate">{label}</span>
      </span>
    {/snippet}
  </TooltipRich>
{/if}
