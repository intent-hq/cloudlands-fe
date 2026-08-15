<script lang="ts">
  import Fa from 'svelte-fa';
  import { faBolt, faChevronDown, faCodePullRequest } from '@fortawesome/free-solid-svg-icons';
  import type { Workspace } from '$shared/types';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { handleLink } from '$features/navigation/link-handler';
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';
  import {
    getPrMonitorWakeChipLabel,
    getPrMonitorWakeUrl,
  } from '$lib/utils/pr-monitor-wake-attribution';
  import type { AutomatedWakePresentation } from './automated-wake-presentation';
  import {
    SUBSCRIPTION_CHEVRON_CLASS,
    SUBSCRIPTION_CHEVRON_SIZE_CLASS,
    SUBSCRIPTION_DISCLOSURE_ROW_CLASS,
    SUBSCRIPTION_ICON_BUTTON_CLASS,
    SUBSCRIPTION_ICON_CLASS,
  } from './subscription-disclosure';

  interface Props {
    presentation: AutomatedWakePresentation;
    expanded: boolean;
    controlsId: string;
    workspace?: Workspace | null;
    ontoggle: () => void;
  }

  let { presentation, expanded, controlsId, workspace = null, ontoggle }: Props = $props();
  const workspaceRepo = $derived(
    workspace?.repositoryOwner && workspace?.repositoryName
      ? `${workspace.repositoryOwner}/${workspace.repositoryName}`
      : undefined,
  );
  const statusLabel = $derived.by(() => {
    if (presentation.kind === 'pr') return m.chat_prMonitorWakeAttribution_wokeAgent_after();
    if (presentation.state === 'active') {
      return m.chat_hookWakeAttribution_wokeAgentStillActive_after();
    }
    if (presentation.state === 'retired') {
      return m.chat_hookWakeAttribution_wokeAgentRetired_after();
    }
    return m.chat_hookWakeAttribution_wokeAgent_after();
  });

  function openPr(event: MouseEvent) {
    if (presentation.kind !== 'pr') return;
    event.stopPropagation();
    void handleLink(getPrMonitorWakeUrl(presentation.attribution), {
      workspaceId: workspace?.id ? WorkspaceId(String(workspace.id)) : undefined,
      forceExternal: true,
    });
  }
</script>

<div
  class="{SUBSCRIPTION_DISCLOSURE_ROW_CLASS} font-medium text-muted-foreground"
  data-testid="automated-wake-header"
  data-wake-kind={presentation.kind}
  data-wake-state={presentation.state}
>
  <Fa
    icon={presentation.kind === 'hook' ? faBolt : faCodePullRequest}
    class="{SUBSCRIPTION_CHEVRON_SIZE_CLASS} shrink-0 {SUBSCRIPTION_ICON_CLASS}"
  />
  {#if presentation.kind === 'hook'}
    <span class="min-w-0 flex-1 truncate" title={presentation.attribution.rawName}>
      {presentation.attribution.displayName}
    </span>
  {:else}
    <Button
      type="button"
      variant="plain"
      class="h-auto min-w-0 flex-1 justify-start whitespace-normal break-words text-left font-inherit text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid="pr-monitor-wake-chip"
      title={m.chat_prMonitorWakeAttribution_openPr_tooltip()}
      onclick={openPr}
    >
      {getPrMonitorWakeChipLabel(presentation.attribution, workspaceRepo)}
    </Button>
  {/if}
  <span
    class="type-caption shrink truncate text-subtle"
    style="max-width: 35%;"
    data-testid="wake-status"
    title={statusLabel}
  >
    {statusLabel}
  </span>
  <button
    type="button"
    class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded {SUBSCRIPTION_ICON_BUTTON_CLASS} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    aria-expanded={expanded}
    aria-controls={controlsId}
    aria-label={expanded
      ? m.chat_agentSubscriptions_collapseWatches_ariaLabel()
      : m.chat_agentSubscriptions_expandWatches_ariaLabel()}
    onclick={ontoggle}
    data-testid="automated-wake-toggle"
  >
    <Fa
      icon={faChevronDown}
      class="{SUBSCRIPTION_CHEVRON_SIZE_CLASS} {SUBSCRIPTION_CHEVRON_CLASS} {expanded
        ? ''
        : 'rotate-90'}"
    />
  </button>
</div>
