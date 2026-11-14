<script lang="ts">
  import Fa from 'svelte-fa';
  import { faBolt } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
  import ChatOperationalRow from './ChatOperationalRow.svelte';
  import {
    CHAT_OPERATIONAL_ICON_CLASS,
    OPERATIONAL_SECONDARY_CLASS,
  } from './operational-disclosure-row';
  import type { AutomatedActivityRun } from './automated-activity-runs';

  interface Props {
    run: AutomatedActivityRun;
    expanded: boolean;
    live?: boolean;
    pinned?: boolean;
    onToggle: () => void;
    triggerElement?: HTMLButtonElement | null;
  }

  let {
    run,
    expanded,
    live = false,
    pinned = false,
    onToggle,
    triggerElement = $bindable(null),
  }: Props = $props();

  const countLabel = $derived(
    run.updateCount === 1
      ? m.chat_automatedActivity_count_one()
      : m.chat_automatedActivity_count_many({ count: formatInteger(run.updateCount) }),
  );
  const sources = $derived(run.sources.join(', '));
  const accessibleLabel = $derived(sources ? `${countLabel}: ${sources}` : countLabel);
</script>

{#snippet leading()}
  <Fa icon={faBolt} size={16} class={CHAT_OPERATIONAL_ICON_CLASS} />
{/snippet}

{#snippet summary()}
  <span>{countLabel}</span>{#if sources}<span class="ml-2.5 {OPERATIONAL_SECONDARY_CLASS}"
      >{sources}</span
    >{/if}
{/snippet}

<div
  class={pinned
    ? 'pointer-events-auto rounded-(--radius-medium) border border-border bg-background shadow-sm'
    : ''}
  data-automated-run-hint={pinned ? undefined : run.id}
  data-automated-run-expanded={pinned ? undefined : expanded}
  data-testid={pinned ? 'automated-activity-pinned-hint' : 'automated-activity-hint'}
>
  <ChatOperationalRow
    {leading}
    {summary}
    interactive
    {expanded}
    streaming={live}
    ariaLabel={accessibleLabel}
    title={accessibleLabel}
    onclick={onToggle}
    bind:triggerElement
    disclosureTestId="automated-activity-hint-toggle"
  />
</div>
