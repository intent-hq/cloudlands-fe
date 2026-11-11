<script lang="ts">
  /**
   * An agent's starting context by section (agent.getSession `promptBreakdown`):
   * total, an owner strip (Intent, user), sections largest first, and hidden skills.
   */
  import { formatCompactNumber } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import type { PromptBreakdownView, PromptOwner } from './prompt-breakdown';

  interface Props {
    breakdown: PromptBreakdownView;
  }

  let { breakdown }: Props = $props();
  const id = $props.id();

  function tokens(value: number): string {
    return formatCompactNumber(value, { maximumFractionDigits: value < 10_000 ? 1 : 0 });
  }

  function ownerLabel(owner: PromptOwner): string {
    return owner === 'intent'
      ? m.agent_contextBreakdown_owner_intent_label()
      : m.agent_contextBreakdown_owner_user_label();
  }

  const ownerSummary = $derived(
    breakdown.owners
      .map((summary) =>
        m.agent_contextBreakdown_ownerShare_label({
          owner: ownerLabel(summary.owner),
          tokens: tokens(summary.estTokens),
        }),
      )
      .join(', '),
  );
</script>

<section class="min-w-0" aria-labelledby={`${id}-title`} data-testid="prompt-breakdown">
  <div class="mb-3 flex items-baseline justify-between gap-3">
    <h3 id={`${id}-title`} class="text-sm font-medium">{m.agent_contextBreakdown_title()}</h3>
    <span class="shrink-0 text-sm tabular-nums text-muted-foreground">
      {m.agent_contextBreakdown_tokens_label({ tokens: tokens(breakdown.estTokens) })}
    </span>
  </div>
  <div
    class="owner-strip mb-3 flex h-1.5 w-full overflow-hidden"
    role="img"
    aria-label={ownerSummary}
  >
    {#each breakdown.owners as summary (summary.owner)}
      <span
        class="owner-fill block h-full"
        data-owner={summary.owner}
        style:flex-grow={summary.share}
      ></span>
    {/each}
  </div>
  <dl class="section-list">
    {#each breakdown.rows as row (row.key)}
      <div class="section-row py-0.5" data-counted={row.counted}>
        <dt class="flex min-w-0 items-start gap-2 text-sm text-foreground">
          <span class="owner-key mt-1.5 size-1.5 shrink-0 rounded-full" data-owner={row.owner}
          ></span>
          <span class="min-w-0 wrap-anywhere">{row.label}</span>
        </dt>
        <dd class="text-xs text-muted-foreground">{ownerLabel(row.owner)}</dd>
        <dd
          class="text-right text-sm tabular-nums {row.counted
            ? 'text-foreground'
            : 'text-muted-foreground'}"
        >
          {tokens(row.estTokens)}
        </dd>
        {#if row.hint || !row.counted}
          <dd class="section-note pl-3.5 text-xs text-muted-foreground wrap-anywhere">
            {[row.counted ? '' : m.agent_contextBreakdown_notCounted_label(), row.hint ?? '']
              .filter(Boolean)
              .join(' · ')}
          </dd>
        {/if}
      </div>
    {/each}
  </dl>
  {#if breakdown.hiddenSkills.length > 0}
    <h4 id={`${id}-hidden`} class="mb-2 mt-4 text-xs font-normal text-muted-foreground">
      {m.agent_contextBreakdown_hiddenSkills_title()}
    </h4>
    <dl class="flex flex-col gap-2" aria-labelledby={`${id}-hidden`}>
      {#each breakdown.hiddenSkills as skill (skill.name)}
        <div class="min-w-0">
          <dt class="truncate text-sm text-foreground">{skill.name}</dt>
          <dd class="text-xs text-muted-foreground wrap-anywhere">
            {[skill.detail, skill.fix].filter(Boolean).join(' · ')}
          </dd>
        </div>
      {/each}
    </dl>
  {/if}
</section>

<style>
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
  .owner-key[data-owner='user'],
  .owner-fill[data-owner='user'] {
    background: hsl(var(--warning) / 88%);
  }
  .section-row[data-counted='false'] .owner-key {
    background: transparent;
    box-shadow: inset 0 0 0 1px hsl(var(--muted-foreground));
  }
</style>
