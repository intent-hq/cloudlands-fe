<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import type { DiffMapLayoutMoreRow } from '../layout/layout-diff-map';

  interface Props {
    row: DiffMapLayoutMoreRow;
    blockX: number;
    blockY: number;
    expanded: boolean;
    onToggle: () => void;
  }

  let { row, blockX, blockY, expanded, onToggle }: Props = $props();
  const label = $derived(
    expanded
      ? m.diffMap_showLess_label()
      : m.diffMap_moreFiles_label({ count: formatInteger(row.hiddenCount) }),
  );
</script>

<Button
  variant="ghost-light"
  class="diff-map-more-row h-auto font-normal"
  data-diff-map-more-row
  aria-expanded={expanded}
  style={`left: ${row.x - blockX}px; top: ${row.y - blockY}px; width: ${row.w}px; height: ${row.h}px`}
  onclick={(event) => {
    event.stopPropagation();
    onToggle();
  }}
>
  {label}
</Button>

<style>
  :global(.diff-map-more-row) {
    position: absolute;
    justify-content: flex-start;
    overflow: hidden;
    padding: 2px 5px 2px 28px;
    border-radius: var(--radius-small);
    color: hsl(var(--muted-foreground));
    font-size: 11px;
    line-height: 1;
    text-align: left;
  }
</style>
