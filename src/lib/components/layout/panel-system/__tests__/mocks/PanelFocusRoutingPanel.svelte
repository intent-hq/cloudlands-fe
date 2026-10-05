<script lang="ts">
  import type { PanelState } from '$features/layout/panel-layout-adapter';

  let {
    panel,
    layoutId,
    isFocused = false,
  }: { panel: PanelState; layoutId: string; isFocused?: boolean } = $props();
</script>

<div
  role="region"
  data-panel-id={panel.id}
  data-layout-id={layoutId}
  data-panel-focused={isFocused ? '' : undefined}
>
  <input data-panel-focus-control={panel.id} aria-label={panel.id} />
</div>
