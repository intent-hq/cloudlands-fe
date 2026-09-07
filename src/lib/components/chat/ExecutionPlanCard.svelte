<script lang="ts">
  import Fa from 'svelte-fa';
  import { faCheck, faCircle, faListCheck, faSpinner } from '@fortawesome/free-solid-svg-icons';
  import { formatInteger } from '$lib/i18n/format';
  import type { PlanEntry, PlanEntryStatus } from '$shared/types';
  import { m } from '$shared/paraglide/messages.js';
  import {
    CHAT_OPERATIONAL_ICON_CLASS,
    CHAT_OPERATIONAL_LEADING_CLASS,
    OPERATIONAL_ROW_GEOMETRY_TOKENS_CLASS,
  } from './operational-disclosure-row';

  let { entries }: { entries: PlanEntry[] } = $props();

  const currentIndex = $derived(entries.findIndex((entry) => entry.status === 'in_progress'));
  const pendingIndex = $derived(entries.findIndex((entry) => entry.status === 'pending'));
  const currentStep = $derived(
    currentIndex >= 0 ? currentIndex + 1 : pendingIndex >= 0 ? pendingIndex + 1 : entries.length,
  );

  function statusLabel(status: PlanEntryStatus): string {
    if (status === 'completed') return m.chat_executionPlan_completed_label();
    if (status === 'in_progress') return m.chat_executionPlan_current_label();
    return m.chat_executionPlan_pending_label();
  }
</script>

{#if entries.length > 0}
  <section
    class="my-2 w-full min-w-0 max-w-full overflow-hidden rounded-lg border border-border bg-background/60 font-family-child"
    aria-label={m.chat_executionPlan_title()}
    data-testid="execution-plan-card"
  >
    <div
      class="{OPERATIONAL_ROW_GEOMETRY_TOKENS_CLASS} grid min-h-8 min-w-0 grid-cols-[var(--operational-leading-slot-size)_minmax(0,1fr)_auto] items-center gap-2 bg-muted/30 px-2 py-1.5"
    >
      <span class={CHAT_OPERATIONAL_LEADING_CLASS} aria-hidden="true">
        <Fa icon={faListCheck} size={16} class={CHAT_OPERATIONAL_ICON_CLASS} />
      </span>
      <h3 class="min-w-0 truncate type-body font-medium text-foreground">
        {m.chat_executionPlan_title()}
      </h3>
      <span class="shrink-0 whitespace-nowrap type-caption text-muted-foreground">
        {m.chat_executionPlan_step_label({
          current: formatInteger(currentStep),
          total: formatInteger(entries.length),
        })}
      </span>
    </div>

    <ol class="min-w-0 border-t border-border py-1" data-testid="execution-plan-entries">
      {#each entries as entry, index (`${index}-${entry.content}`)}
        <li
          class="{OPERATIONAL_ROW_GEOMETRY_TOKENS_CLASS} grid min-h-7 min-w-0 max-w-full grid-cols-[var(--operational-leading-slot-size)_minmax(0,1fr)] items-start gap-2 px-2 py-1.5 type-body {entry.status ===
          'in_progress'
            ? 'bg-muted/30'
            : ''}"
          data-plan-status={entry.status}
          aria-current={entry.status === 'in_progress' ? 'step' : undefined}
        >
          <span class="{CHAT_OPERATIONAL_LEADING_CLASS} mt-0.5" aria-hidden="true">
            {#if entry.status === 'completed'}
              <Fa icon={faCheck} size={14} class={CHAT_OPERATIONAL_ICON_CLASS} />
            {:else if entry.status === 'in_progress'}
              <Fa
                icon={faSpinner}
                size={14}
                class="{CHAT_OPERATIONAL_ICON_CLASS} animate-spin motion-reduce:animate-none"
              />
            {:else}
              <Fa icon={faCircle} size={7} class="h-2! w-2! shrink-0 opacity-50" />
            {/if}
          </span>
          <span
            class="min-w-0 whitespace-normal break-words text-foreground"
            class:font-medium={entry.status === 'in_progress'}
            class:line-through={entry.status === 'completed'}
            class:opacity-65={entry.status !== 'in_progress'}
          >
            <span class="sr-only">{statusLabel(entry.status)}: </span>
            {entry.content}
          </span>
        </li>
      {/each}
    </ol>
  </section>
{/if}
