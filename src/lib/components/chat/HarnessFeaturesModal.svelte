<script lang="ts">
  /**
   * Read-only modal listing the harness features an agent session was
   * created with (PROTOCOL §5.5 `harnessVersion` / `harnessFeatures`;
   * monorepo#2459). Opened from the agent tab ⋯ menu and the AgentCard
   * context menu.
   *
   * Rows follow the settings page's agent-features list styling (name +
   * description left, state right), but are informational only — the
   * snapshot is immutable for the session's lifetime. The canonical dialog
   * primitive provides overlay, focus trap, escape/outside dismissal, the
   * X close button, and body scrolling when the list exceeds the viewport.
   */
  import * as Dialog from '$lib/components/ui/dialog';
  import { m } from '$shared/paraglide/messages.js';
  import { buildHarnessFeatureRows } from './harness-feature-catalog';

  interface Props {
    open?: boolean;
    /** Harness version stamp, rendered in the title (verbatim). */
    version: string;
    /** Session `harnessFeatures` snapshot; null/absent renders all catalog rows OFF. */
    features?: Record<string, boolean> | null;
  }

  let { open = $bindable(false), version, features = null }: Props = $props();

  const rows = $derived(buildHarnessFeatureRows(features));
</script>

<Dialog.Root bind:open>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>
        {m.chat_harnessFeaturesModal_title({ version })}
      </Dialog.Title>
      <Dialog.Description>
        {m.chat_harnessFeaturesModal_description()}
      </Dialog.Description>
    </Dialog.Header>
    <div class="flex flex-col divide-y divide-border" data-testid="harness-features-list">
      {#each rows as row (row.key)}
        <section class="flex items-start justify-between gap-3 py-3">
          <div class="min-w-0">
            <p class="text-sm font-medium text-foreground">{row.label}</p>
            {#if row.description}
              <p class="text-xs text-subtle mt-1">{row.description}</p>
            {/if}
          </div>
          <span
            class="shrink-0 text-xs {row.enabled ? 'text-foreground' : 'text-muted-foreground'}"
            data-testid="harness-feature-state"
            data-feature={row.key}
            data-enabled={row.enabled}
          >
            {row.enabled ? m.chat_shared_valueOn_label() : m.chat_shared_valueOff_label()}
          </span>
        </section>
      {/each}
    </div>
  </Dialog.Content>
</Dialog.Root>
