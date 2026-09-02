<script lang="ts">
  /**
   * AutomatedWakeCardHeader
   *
   * The whole header bar is a toggle hit-target for the disclosure; the
   * chevron button carries the disclosure semantics (aria-expanded /
   * aria-controls) and keyboard activation. The PR chip stays a sibling
   * interactive control — the row handler ignores clicks originating from
   * any button so neither action can activate the other and the card never
   * nests interactive controls.
   */
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

  function handleRowClick(event: MouseEvent) {
    // Sibling buttons (PR chip, chevron toggle) own their own clicks.
    if ((event.target as HTMLElement | null)?.closest('button')) return;
    ontoggle();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events (keyboard toggle lives on the chevron button) -->
<!-- svelte-ignore a11y_no_static_element_interactions (row is an enlarged hit-target for the chevron toggle) -->
<div
  class="{SUBSCRIPTION_DISCLOSURE_ROW_CLASS} cursor-pointer"
  data-testid="automated-wake-header"
  data-wake-kind={presentation.kind}
  data-wake-state={presentation.state}
  onclick={handleRowClick}
>
  <Fa
    icon={presentation.kind === 'hook' ? faBolt : faCodePullRequest}
    size={16}
    class="{SUBSCRIPTION_CHEVRON_SIZE_CLASS} mt-1 shrink-0 self-start {SUBSCRIPTION_ICON_CLASS}"
  />
  <span
    class="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1 text-left"
    data-testid="automated-wake-text-lane"
  >
    {#if presentation.kind === 'hook'}
      <span
        class="min-w-0 max-w-full break-words"
        title={presentation.attribution.rawName}
        data-testid="automated-wake-primary-label"
      >
        {presentation.attribution.displayName}
      </span>
    {:else}
      {@const chipLabel = getPrMonitorWakeChipLabel(presentation.attribution, workspaceRepo)}
      <Button
        type="button"
        variant="plain"
        class="h-auto min-w-0 max-w-full justify-start whitespace-normal break-words text-left font-inherit text-muted-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid="pr-monitor-wake-chip"
        title={m.chat_prMonitorWakeAttribution_openPrWithLabel_tooltip({ label: chipLabel })}
        onclick={openPr}
      >
        <span class="min-w-0 break-words">
          {chipLabel}
        </span>
      </Button>
    {/if}
    <span
      class="type-body min-w-0 max-w-full break-words font-normal text-muted-foreground"
      data-testid="wake-status"
      title={statusLabel}
    >
      {statusLabel}
    </span>
  </span>
  <button
    type="button"
    class="inline-flex h-6 w-6 shrink-0 self-start items-center justify-center rounded {SUBSCRIPTION_ICON_BUTTON_CLASS} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
      size={16}
      class="{SUBSCRIPTION_CHEVRON_SIZE_CLASS} {SUBSCRIPTION_CHEVRON_CLASS} {expanded
        ? ''
        : 'rotate-90'}"
    />
  </button>
</div>
