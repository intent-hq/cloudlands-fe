<script lang="ts">
  /**
   * Read-only modal listing the harness features an agent session was
   * created with (PROTOCOL §5.5 `harnessVersion` / `harnessFeatures`;
   * monorepo#2459). Opened from the agent tab ⋯ menu and the AgentCard
   * context menu.
   *
   * The agent's starting context breakdown (agent.getSession `promptBreakdown`)
   * leads when the session recorded one. Features are grouped into On/Off
   * columns (stacked on narrow screens), descriptions in tooltips, and are
   * informational only — the
   * snapshot is immutable for the session's lifetime. The canonical dialog
   * primitive provides overlay, focus trap, escape/outside dismissal, the
   * X close button, and body scrolling when the list exceeds the viewport.
   */
  import { ContentDialog } from '$lib/components/patterns/confirm';
  import { ListRow } from '$lib/components/patterns/collection';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import PromptBreakdownPanel from '$features/agent/prompt-breakdown/PromptBreakdownPanel.svelte';
  import { loadPromptBreakdown } from '$features/agent/prompt-breakdown/load-prompt-breakdown';
  import type { PromptBreakdownView } from '$features/agent/prompt-breakdown/prompt-breakdown';
  import { m } from '$shared/paraglide/messages.js';
  import { buildHarnessFeatureRows } from './harness-feature-catalog';

  interface Props {
    open?: boolean;
    static?: boolean;
    /** Harness version stamp, rendered in the title (verbatim). */
    version: string;
    /** Session `harnessFeatures` snapshot; null/absent renders all catalog rows OFF. */
    features?: Record<string, boolean> | null;
    /** Session to read the starting context breakdown for, when the modal opens. */
    agentId?: string;
    /** A breakdown to show instead of reading one. */
    breakdown?: PromptBreakdownView | null;
  }

  let {
    open = $bindable(false),
    static: staticPosition = false,
    version,
    features = null,
    agentId,
    breakdown,
  }: Props = $props();
  const id = $props.id();

  // Read on every open: the daemon replaces the breakdown on each respawn. The last
  // result stays on screen while the dialog closes and until the next read lands.
  let loaded = $state<{ agentId: string; view: PromptBreakdownView | null } | null>(null);
  const readsBreakdown = $derived(breakdown === undefined && !!agentId);
  $effect(() => {
    if (!open || !readsBreakdown || !agentId) return;
    const id = agentId;
    let current = true;
    void loadPromptBreakdown(id).then((view) => {
      if (current) loaded = { agentId: id, view };
    });
    return () => {
      current = false;
    };
  });
  const shownBreakdown = $derived(
    breakdown !== undefined
      ? breakdown
      : readsBreakdown && loaded && loaded.agentId === agentId
        ? loaded.view
        : null,
  );

  const rows = $derived(buildHarnessFeatureRows(features));
  const groups = $derived([
    {
      enabled: true,
      label: m.chat_shared_valueOn_label(),
      rows: rows.filter((row) => row.enabled),
    },
    {
      enabled: false,
      label: m.chat_shared_valueOff_label(),
      rows: rows.filter((row) => !row.enabled),
    },
  ]);
</script>

<ContentDialog
  bind:open
  static={staticPosition}
  title={m.chat_harnessFeaturesModal_title({ version })}
  size="wide"
>
  <div class="@container">
    {#if shownBreakdown}
      <div class="mb-6 border-b border-border pb-6">
        <PromptBreakdownPanel breakdown={shownBreakdown} />
      </div>
    {/if}
    <section aria-labelledby={`${id}-capabilities`}>
      <h3 id={`${id}-capabilities`} class="text-sm font-medium">
        {m.chat_harnessFeaturesModal_capabilities_title()}
      </h3>
      <p class="mb-4 mt-1 text-sm text-muted-foreground">
        {m.chat_harnessFeaturesModal_description()}
      </p>
      <div
        class="grid grid-cols-1 gap-6 @min-[28rem]:grid-cols-2"
        data-testid="harness-features-list"
      >
        {#each groups as group (group.enabled)}
          <section class="min-w-0" aria-label={group.label}>
            <h4 class="text-sm font-medium mb-3">{group.label}</h4>
            <div role="list" class="space-y-2">
              {#each group.rows as row (row.key)}
                <ListRow
                  role="listitem"
                  class="min-h-0 px-0 py-0 [&_.truncate]:whitespace-normal"
                  data-testid="harness-feature-state"
                  data-feature={row.key}
                  data-enabled={row.enabled}
                >
                  {#snippet title()}
                    {#if row.description}
                      <Tooltip content={row.description} side="top" size="sm">
                        <span>{row.label}</span>
                      </Tooltip>
                      <span class="sr-only">{row.description}</span>
                    {:else}
                      {row.label}
                    {/if}
                  {/snippet}
                </ListRow>
              {:else}
                <div role="listitem" class="text-xs text-subtle" aria-hidden="true">—</div>
              {/each}
            </div>
          </section>
        {/each}
      </div>
    </section>
  </div>
</ContentDialog>
