<script lang="ts">
  /**
   * Read-only modal listing the harness features an agent session was
   * created with (PROTOCOL §5.5 `harnessVersion` / `harnessFeatures`;
   * monorepo#2459). Opened from the agent tab ⋯ menu and the AgentCard
   * context menu.
   *
   * Features are grouped into On/Off columns (stacked on narrow screens),
   * and are informational only — the
   * snapshot is immutable for the session's lifetime. The canonical dialog
   * primitive provides overlay, focus trap, escape/outside dismissal, the
   * X close button, and body scrolling when the list exceeds the viewport.
   */
  import { ContentDialog } from '$lib/components/patterns/confirm';
  import { ListRow } from '$lib/components/patterns/collection';
  import { m } from '$shared/paraglide/messages.js';
  import { buildHarnessFeatureRows } from './harness-feature-catalog';

  interface Props {
    open?: boolean;
    static?: boolean;
    /** Harness version stamp, rendered in the title (verbatim). */
    version: string;
    /** Session `harnessFeatures` snapshot; null/absent renders all catalog rows OFF. */
    features?: Record<string, boolean> | null;
  }

  let {
    open = $bindable(false),
    static: staticPosition = false,
    version,
    features = null,
  }: Props = $props();

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
  description={m.chat_harnessFeaturesModal_description()}
  size="wide"
>
  <div class="@container">
    <div
      class="grid grid-cols-1 gap-6 @min-[28rem]:grid-cols-2"
      data-testid="harness-features-list"
    >
      {#each groups as group (group.enabled)}
        <section class="min-w-0" aria-label={group.label}>
          <h3 class="text-sm font-medium mb-3">{group.label}</h3>
          <div role="list" class="space-y-4">
            {#each group.rows as row (row.key)}
              <ListRow
                role="listitem"
                class="min-h-0 px-0 py-0 [&_.truncate]:whitespace-normal"
                data-testid="harness-feature-state"
                data-feature={row.key}
                data-enabled={row.enabled}
              >
                {#snippet title()}{row.label}{/snippet}
                {#snippet description()}{row.description}{/snippet}
              </ListRow>
            {:else}
              <div role="listitem" class="text-xs text-subtle" aria-hidden="true">—</div>
            {/each}
          </div>
        </section>
      {/each}
    </div>
  </div>
</ContentDialog>
