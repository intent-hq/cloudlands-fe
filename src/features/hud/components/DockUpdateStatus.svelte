<script lang="ts">
  import { m } from '$shared/paraglide/messages.js';
  import WorkspaceStatusIcon from '$lib/components/workspace/WorkspaceStatusIcon.svelte';
  import { getWorkspaceStatusPresentation } from '$lib/components/workspace/utils/workspace-status-presentation';
  import { formatInteger } from '$lib/i18n/format';
  import { getActiveLocale } from '$lib/i18n/locale';
  import type { DockStatusGroup } from '$features/hud/utils/dock-status-groups';

  /** One glyph per status present in the rows, highest priority first; counts are in the label. */
  let { groups }: { groups: readonly DockStatusGroup[] } = $props();
  const total = $derived(groups.reduce((sum, group) => sum + group.count, 0));
  const label = $derived(
    new Intl.ListFormat(getActiveLocale(), { type: 'unit', style: 'short' }).format(
      groups.map((group) =>
        m.dock_statusGroup_label({
          status: getWorkspaceStatusPresentation(group.status).label,
          count: formatInteger(group.count),
        }),
      ),
    ),
  );
</script>

{#if groups.length}
  <span
    class="notch-updates"
    role="status"
    aria-label={label}
    title={label}
    data-testid="dock-update-count"
    data-count={total}
  >
    {#each groups as group (group.status)}
      <span
        class="notch-status-glyph"
        data-status-group={group.status}
        data-status-count={group.count}
        aria-hidden="true"><WorkspaceStatusIcon status={group.status} size={12} decorative /></span
      >
    {/each}
  </span>
{/if}

<style>
  .notch-updates {
    display: flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }
  .notch-status-glyph {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 12px;
    height: 12px;
  }
  /* Same 6px dot as the rows' badges; icon statuses keep their 12px glyph. */
  .notch-status-glyph :global(.workspace-status-dot) {
    width: 6px;
    height: 6px;
  }
</style>
