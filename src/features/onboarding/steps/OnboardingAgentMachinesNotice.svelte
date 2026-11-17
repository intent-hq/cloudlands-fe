<script lang="ts">
  /**
   * Welcome step on an orchestrator: it runs no agents itself, so the
   * providers picked here run on the user's machines, which sign in to them
   * (PROTOCOL provider-profiles.md → "Profiles on an orchestrator"). With no
   * machine in the ordered list the first workspace could not start an agent,
   * so the step points to Settings → Machines. Renders nothing on a Full daemon.
   */
  import Fa from 'svelte-fa';
  import { faCircleInfo, faServer, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
  import { goto } from '$app/navigation';
  import { getAppUiTargets } from '$shared/app-ui-targets';
  import { m } from '$shared/paraglide/messages.js';
  import { Button } from '$lib/components/ui/button';
  import { cn } from '$lib/utils';
  import type { OnboardingAgentMachines } from '../utils/onboarding-agent-machines';

  interface Props {
    machines: OnboardingAgentMachines;
  }

  let { machines }: Props = $props();

  // The Settings → Machines target the assistant's nav links also use.
  const SETTINGS_MACHINES_ROUTE =
    getAppUiTargets().find((target) => target.id === 'devices')?.route ?? '/settings?tab=devices';
</script>

{#if machines !== 'backend'}
  {@const missing = machines === 'none'}
  <div
    class={[
      'w-full max-w-xl rounded-md border px-4 py-3 text-sm',
      missing ? 'border-warning/30 bg-warning/10' : 'border-border bg-muted/30',
    ]}
    role={missing ? 'alert' : 'status'}
    data-testid="onboarding-agent-machines"
    data-machines={machines}
  >
    <div class="flex items-start gap-3">
      <Fa
        icon={missing ? faTriangleExclamation : faCircleInfo}
        class={cn('mt-0.5 shrink-0', missing ? 'text-warning-ink' : 'text-muted-foreground')}
      />
      <div class="min-w-0">
        <p class={['font-medium', missing && 'text-warning-ink']}>
          {missing
            ? m.onboarding_agentMachines_none_title()
            : m.onboarding_agentMachines_onMachines_title()}
        </p>
        <p class="mt-1 text-subtle">
          {missing
            ? m.onboarding_agentMachines_none_description()
            : m.onboarding_agentMachines_onMachines_description()}
        </p>
        {#if machines !== 'machines'}
          <div class="mt-2">
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onclick={() => void goto(SETTINGS_MACHINES_ROUTE)}
            >
              <Fa icon={faServer} size="sm" class="mr-1" />
              {m.onboarding_agentMachines_openSettings_label()}
            </Button>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}
