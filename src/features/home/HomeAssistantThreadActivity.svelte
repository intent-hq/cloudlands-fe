<script lang="ts">
  import { onMount } from 'svelte';
  import { toStore } from 'svelte/store';
  import Fa from 'svelte-fa';
  import { faBell, faClock, faEye } from '@fortawesome/free-solid-svg-icons';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import { formatInteger } from '$lib/i18n/format';
  import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import { requestSubscriptionFetch } from '$store/renderer/slices/agent-subscription-ui/agent-subscription-ui-slice';
  import { selectAssistantThreadActivity } from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';

  let { agentId }: { agentId: string } = $props();
  const activity$ = selectAssistantThreadActivity(toStore(() => agentId));
  const indicators = $derived(
    [
      {
        kind: 'hooks',
        count: $activity$.hooks,
        icon: faClock,
        label: m.home_assistantThread_hooks_label({ count: formatInteger($activity$.hooks) }),
      },
      {
        kind: 'monitors',
        count: $activity$.monitors,
        icon: faEye,
        label: m.home_assistantThread_monitors_label({ count: formatInteger($activity$.monitors) }),
      },
      {
        kind: 'subscriptions',
        count: $activity$.subscriptions,
        icon: faBell,
        label: m.home_assistantThread_subscriptions_label({
          count: formatInteger($activity$.subscriptions),
        }),
      },
    ].filter((indicator) => indicator.count > 0),
  );

  onMount(() => {
    appStore.dispatch(requestSubscriptionFetch(CHIEF_WORKSPACE_ID, agentId, true));
  });
</script>

{#if indicators.length > 0}
  <span class="inline-flex shrink-0 items-center gap-1.5 text-muted-foreground">
    <Tooltip.Provider>
      {#each indicators as indicator (indicator.kind)}
        <Tooltip.Root>
          <Tooltip.Trigger tabindex={-1}>
            {#snippet child({ props })}
              <span
                {...props}
                tabindex={undefined}
                data-thread-activity={indicator.kind}
                role="img"
                aria-label={indicator.label}
              >
                <Fa icon={indicator.icon} class="size-3.5" />
              </span>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content>{indicator.label}</Tooltip.Content>
        </Tooltip.Root>
      {/each}
    </Tooltip.Provider>
  </span>
{/if}
