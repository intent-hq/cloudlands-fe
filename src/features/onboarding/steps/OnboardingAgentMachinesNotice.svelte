<script lang="ts">
  /**
   * Welcome step on an orchestrator with no machine in its ordered list: it
   * runs no agents itself, so the first workspace could not start an agent
   * (PROTOCOL methods/nodes.md → "Orchestrator mode"). Points to
   * Settings → Machines. Renders nothing otherwise.
   */
  import Fa from 'svelte-fa';
  import { faServer, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
  import { goto } from '$app/navigation';
  import { getAppUiTargets } from '$shared/app-ui-targets';
  import { m } from '$shared/paraglide/messages.js';
  import { Button } from '$lib/components/ui/button';
  import type { OnboardingAgentMachines } from '../utils/onboarding-agent-machines';

  interface Props {
    machines: OnboardingAgentMachines;
  }

  let { machines }: Props = $props();

  // The Settings → Machines target the assistant's nav links also use.
  const SETTINGS_MACHINES_ROUTE =
    getAppUiTargets().find((target) => target.id === 'devices')?.route ?? '/settings?tab=devices';
</script>

{#if machines === 'none'}
  <div
    class="w-full max-w-xl rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm"
    role="alert"
    data-testid="onboarding-agent-machines"
    data-machines={machines}
  >
    <div class="flex items-start gap-3">
      <Fa icon={faTriangleExclamation} class="mt-0.5 shrink-0 text-warning-ink" />
      <div class="min-w-0">
        <p class="font-medium text-warning-ink">{m.onboarding_agentMachines_none_title()}</p>
        <p class="mt-1 text-subtle">{m.onboarding_agentMachines_none_description()}</p>
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
      </div>
    </div>
  </div>
{/if}
