<script lang="ts">
  import { TooltipRich } from '$lib/components/ui/tooltip';
  import DrivingClientIndicator from '$lib/components/workspace/DrivingClientIndicator.svelte';

  let {
    variant = 'browser',
  }: {
    variant?: 'browser' | 'default' | 'info' | 'success' | 'warning' | 'error';
  } = $props();
</script>

<!-- i18n-ignore (browser regression fixture, not user-facing) -->
<section class="m-8 w-80 bg-background p-4 text-foreground">
  <h2 class="type-heading">Finance Team</h2>
  {#if variant === 'browser'}
    <DrivingClientIndicator
      eligibleClients={[]}
      ownClientId="local"
      driving={{
        clientId: 'offline',
        name: 'Finance Team shared browser on the accounting workstation',
        connected: false,
      }}
      hasBrowserTabs
    />
  {:else}
    <TooltipRich
      title="Browser connection status"
      description="Reconnect the shared workstation to continue using browser tabs."
      {variant}
      side="bottom"
      align="start"
    >
      <span>Browser status</span>
    </TooltipRich>
  {/if}
  <!-- Match the positioned status content in WorkspaceProgressCard. -->
  <div data-testid="underlying-status" class="relative z-10 mt-2 type-body">
    <p class="bg-foreground text-background">Finance Team status</p>
    <p>Preparing the quarterly report and reconciling outstanding invoices.</p>
    <p>Waiting for the shared workstation to reconnect.</p>
  </div>
</section>
