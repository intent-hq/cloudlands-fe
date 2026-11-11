<script lang="ts">
  /**
   * Starting-context ring for an agent header: a donut split by owner (Intent, repo,
   * user) with the estimated token count. Opens a per-section breakdown.
   */
  import * as Popover from '$lib/components/ui/popover';
  import { Button } from '$lib/components/ui/button';
  import { formatCompactNumber } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import type { PromptBreakdownView, PromptOwnerGroup } from './prompt-breakdown';

  interface Props {
    breakdown: PromptBreakdownView;
    open?: boolean;
  }

  let { breakdown, open = $bindable(false) }: Props = $props();
  const id = $props.id();

  const RADIUS = 5.5;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
  const GAP = 1.25;

  function tokens(value: number): string {
    return formatCompactNumber(value, { maximumFractionDigits: value < 10_000 ? 1 : 0 });
  }

  function ownerLabel(group: PromptOwnerGroup): string {
    if (group === 'intent') return m.agent_contextBreakdown_owner_intent_label();
    if (group === 'repo') return m.agent_contextBreakdown_owner_repo_label();
    return m.agent_contextBreakdown_owner_user_label();
  }

  const arcs = $derived.by(() => {
    const gap = breakdown.owners.length > 1 ? GAP : 0;
    let offset = 0;
    return breakdown.owners.map((owner) => {
      const length = owner.share * CIRCUMFERENCE;
      const arc = {
        group: owner.group,
        dash: `${Math.max(length - gap, 0.01)} ${CIRCUMFERENCE}`,
        offset: -offset,
      };
      offset += length;
      return arc;
    });
  });

  const total = $derived(tokens(breakdown.estTokens));
</script>

<Popover.Root bind:open>
  <Popover.Trigger>
    {#snippet child({ props })}
      <Button
        {...props}
        variant="ghost-light"
        size="sm"
        wrapContent={false}
        class="panel-header-action-button gap-1.5 px-1.5 text-xs font-normal tabular-nums text-muted-foreground"
        aria-label={m.agent_contextBreakdown_trigger_ariaLabel({ tokens: total })}
        data-testid="prompt-breakdown-trigger"
      >
        <svg viewBox="0 0 16 16" class="size-3.5! shrink-0 -rotate-90" aria-hidden="true">
          <circle class="ring-track" cx="8" cy="8" r={RADIUS} fill="none" stroke-width="2.5" />
          {#each arcs as arc (arc.group)}
            <circle
              class="ring-arc"
              data-owner={arc.group}
              cx="8"
              cy="8"
              r={RADIUS}
              fill="none"
              stroke-width="2.5"
              stroke-dasharray={arc.dash}
              stroke-dashoffset={arc.offset}
            />
          {/each}
        </svg>
        <span aria-hidden="true">{total}</span>
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content
    align="end"
    class="prompt-breakdown w-80 max-h-[min(40rem,var(--bits-popover-content-available-height))] overflow-y-auto p-0"
    data-testid="prompt-breakdown-popover"
  >
    <section class="px-4 pb-3 pt-3" aria-labelledby={`${id}-title`}>
      <div class="mb-3 flex items-baseline justify-between gap-3">
        <h4 id={`${id}-title`} class="text-xs font-normal text-muted-foreground">
          {m.agent_contextBreakdown_title()}
        </h4>
        <span class="shrink-0 text-sm tabular-nums text-foreground">
          {m.agent_contextBreakdown_tokens_label({ tokens: total })}
        </span>
      </div>
      <div class="owner-strip mb-4 flex h-1.5 w-full overflow-hidden" aria-hidden="true">
        {#each breakdown.owners as owner (owner.group)}
          <span
            class="owner-fill block h-full"
            data-owner={owner.group}
            style:flex-grow={owner.share}
          ></span>
        {/each}
      </div>
      <dl class="section-list">
        {#each breakdown.rows as row (row.key)}
          <div class="section-row py-0.5" data-counted={row.counted}>
            <dt class="flex min-w-0 items-start gap-2 text-sm text-foreground">
              <span class="owner-key mt-1.5 size-1.5 shrink-0 rounded-full" data-owner={row.group}
              ></span>
              <span class="min-w-0 break-words">{row.label}</span>
            </dt>
            <dd class="text-xs text-muted-foreground">{ownerLabel(row.group)}</dd>
            <dd
              class="text-right text-sm tabular-nums {row.counted
                ? 'text-foreground'
                : 'text-muted-foreground'}"
            >
              {tokens(row.estTokens)}
            </dd>
            {#if row.hint || !row.counted}
              <dd class="section-note pl-3.5 text-xs text-muted-foreground">
                {[row.counted ? '' : m.agent_contextBreakdown_notCounted_label(), row.hint ?? '']
                  .filter(Boolean)
                  .join(' · ')}
              </dd>
            {/if}
          </div>
        {/each}
      </dl>
    </section>
    {#if breakdown.hiddenSkills.length > 0}
      <section class="border-t border-border px-4 pb-3 pt-3" aria-labelledby={`${id}-hidden`}>
        <h4 id={`${id}-hidden`} class="mb-2 text-xs font-normal text-muted-foreground">
          {m.agent_contextBreakdown_hiddenSkills_title()}
        </h4>
        <dl class="flex flex-col gap-2">
          {#each breakdown.hiddenSkills as skill (skill.name)}
            <div class="min-w-0">
              <dt class="truncate text-sm text-foreground">{skill.name}</dt>
              <dd class="text-xs text-muted-foreground">
                {[skill.detail, skill.fix].filter(Boolean).join(' · ')}
              </dd>
            </div>
          {/each}
        </dl>
      </section>
    {/if}
  </Popover.Content>
</Popover.Root>

<style>
  .ring-track {
    stroke: hsl(var(--muted-foreground) / 22%);
  }
  .section-list {
    display: grid;
    grid-template-columns: minmax(0, 1fr) max-content 3rem;
    column-gap: 0.75rem;
  }
  .section-row {
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: subgrid;
    align-items: baseline;
  }
  .section-note {
    grid-column: 1 / -1;
  }
  .owner-strip {
    gap: 1px;
    border-radius: 2px;
    background: hsl(var(--border));
  }
  .owner-fill {
    flex-basis: 0;
  }
  .owner-key[data-owner='intent'],
  .owner-fill[data-owner='intent'] {
    background: hsl(var(--token-usage-input) / 84%);
  }
  .owner-key[data-owner='repo'],
  .owner-fill[data-owner='repo'] {
    background: hsl(var(--info) / 82%);
  }
  .owner-key[data-owner='user'],
  .owner-fill[data-owner='user'] {
    background: hsl(var(--warning) / 88%);
  }
  .section-row[data-counted='false'] .owner-key {
    background: transparent;
    box-shadow: inset 0 0 0 1px hsl(var(--muted-foreground));
  }
  .ring-arc[data-owner='intent'] {
    stroke: hsl(var(--token-usage-input));
  }
  .ring-arc[data-owner='repo'] {
    stroke: hsl(var(--info));
  }
  .ring-arc[data-owner='user'] {
    stroke: hsl(var(--warning));
  }
</style>
