<script lang="ts">
  type Selection = { type: string; transitionIndex?: number } | null;
  let {
    selection,
    onSelectCrossing,
  }: { selection: Selection; onSelectCrossing?: (transitionIndex: number) => void } = $props();
</script>

<div
  data-testid="semantic-map-detail"
  data-transition-index={selection?.type === 'crossing' ? selection.transitionIndex : undefined}
  role="button"
  tabindex="0"
  onclick={() => onSelectCrossing?.(0)}
  onkeydown={(event) => event.key === 'Enter' && onSelectCrossing?.(0)}
></div>
