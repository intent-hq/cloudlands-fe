<script lang="ts">
  import { TooltipRich } from '$lib/components/ui/tooltip';

  let {
    variant = 'default',
  }: {
    variant?: 'default' | 'info' | 'success' | 'warning' | 'error';
  } = $props();
</script>

<!-- i18n-ignore (browser regression fixture, not user-facing) -->
<section class="m-8 w-80 bg-background p-4 text-foreground">
  <h2 class="type-heading">Finance Team</h2>
  <TooltipRich
    title="Browser connection status"
    description="Reconnect the shared workstation to continue using browser tabs."
    {variant}
    side="bottom"
    align="start"
  >
    <span>Browser status</span>
  </TooltipRich>
  <!-- Match the positioned status content in WorkspaceProgressCard. -->
  <div data-testid="underlying-status" class="relative z-10 mt-2 type-body">
    <p class="surface-inverse">Finance Team status</p>
    <p>Preparing the quarterly report and reconciling outstanding invoices.</p>
    <p>Waiting for the shared workstation to reconnect.</p>
  </div>
</section>
