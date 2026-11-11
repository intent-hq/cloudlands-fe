<script lang="ts">
  /**
   * An agent's starting context (agent.getSession `promptBreakdown`): total, an owner
   * strip, Native/User/Intent groups that expand to their sections, and hidden skills.
   */
  import * as Accordion from '$lib/components/ui/accordion';
  import { formatCompactNumber, formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import type { PromptBreakdownView, PromptGroupKind } from './prompt-breakdown';

  interface Props {
    breakdown: PromptBreakdownView;
  }

  let { breakdown }: Props = $props();
  const id = $props.id();

  const trigger = 'type-body font-normal text-foreground data-[state=open]:font-normal';

  function tokens(value: number): string {
    return formatCompactNumber(value, { maximumFractionDigits: value < 10_000 ? 1 : 0 });
  }

  function groupLabel(kind: PromptGroupKind): string {
    if (kind === 'native') return m.agent_contextBreakdown_owner_native_label();
    return kind === 'intent'
      ? m.agent_contextBreakdown_owner_intent_label()
      : m.agent_contextBreakdown_owner_user_label();
  }

  const ownerSummary = $derived(
    breakdown.owners
      .map((summary) =>
        m.agent_contextBreakdown_ownerShare_label({
          owner: groupLabel(summary.owner),
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
    class="owner-strip mb-2 flex h-1.5 w-full overflow-hidden"
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
  <Accordion.Root type="multiple">
    {#each breakdown.groups as group (group.kind)}
      <Accordion.Item value={group.kind} data-prompt-group={group.kind}>
        <Accordion.Header level={4}>
          <Accordion.Trigger inset={false} class={trigger}>
            <span class="flex items-center gap-2">
              <span class="group-key size-1.5 shrink-0 rounded-full" data-kind={group.kind}></span>
              <span class="min-w-0 flex-1">{groupLabel(group.kind)}</span>
              {#if group.kind === 'native'}
                <span class="shrink-0 text-xs text-muted-foreground">
                  {m.agent_contextBreakdown_notCounted_label()}
                </span>
              {/if}
              <span
                class="shrink-0 tabular-nums {group.kind === 'native'
                  ? 'text-muted-foreground'
                  : ''}"
              >
                {tokens(group.estTokens)}
              </span>
            </span>
          </Accordion.Trigger>
        </Accordion.Header>
        <Accordion.Content inset={false}>
          <dl class="ml-3.5 text-foreground">
            {#each group.rows as row (row.key)}
              <div class="grid grid-cols-[0.375rem_1fr_auto] items-baseline gap-x-3 py-0.5 text-sm">
                <span class="size-1 self-center rounded-full bg-muted-foreground" aria-hidden="true"
                ></span>
                <dt class="min-w-0 wrap-anywhere">{row.label}</dt>
                <dd class="tabular-nums {row.counted ? '' : 'text-muted-foreground'}">
                  {tokens(row.estTokens)}
                </dd>
                {#if row.hint}
                  <dd class="col-start-2 col-end-4 text-xs text-muted-foreground wrap-anywhere">
                    {row.hint}
                  </dd>
                {/if}
              </div>
            {/each}
          </dl>
        </Accordion.Content>
      </Accordion.Item>
    {/each}
    {#if breakdown.hiddenSkills.length > 0}
      <Accordion.Item value="hidden-skills" class="mt-1">
        <Accordion.Header level={4}>
          <Accordion.Trigger inset={false} class={trigger}>
            <span class="flex items-center gap-2">
              <span class="min-w-0 flex-1">{m.agent_contextBreakdown_hiddenSkills_title()}</span>
              <span class="shrink-0 tabular-nums text-muted-foreground">
                {formatInteger(breakdown.hiddenSkills.length)}
              </span>
            </span>
          </Accordion.Trigger>
        </Accordion.Header>
        <Accordion.Content inset={false}>
          <dl class="ml-3.5 flex flex-col gap-2">
            {#each breakdown.hiddenSkills as skill (skill.name)}
              <div class="min-w-0">
                <dt class="truncate text-sm text-foreground">{skill.name}</dt>
                <dd class="text-xs text-muted-foreground wrap-anywhere">
                  {[skill.detail, skill.fix].filter(Boolean).join(' · ')}
                </dd>
              </div>
            {/each}
          </dl>
        </Accordion.Content>
      </Accordion.Item>
    {/if}
  </Accordion.Root>
</section>

<style>
  .owner-strip {
    gap: 1px;
    border-radius: 2px;
    background: hsl(var(--border));
  }
  .owner-fill {
    flex-basis: 0;
  }
  .group-key[data-kind='intent'],
  .owner-fill[data-owner='intent'] {
    background: hsl(var(--token-usage-input) / 84%);
  }
  .group-key[data-kind='user'],
  .owner-fill[data-owner='user'] {
    background: hsl(var(--warning) / 88%);
  }
  .group-key[data-kind='native'] {
    box-shadow: inset 0 0 0 1px hsl(var(--muted-foreground));
  }
</style>
