<script lang="ts" module>
  import { hudLeftColumnPreview } from './hud-left-column.preview-fixtures';
  export const preview = hudLeftColumnPreview;
</script>

<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import HudLeftColumn from './HudLeftColumn.svelte';
  import {
    createHudLeftColumnPreview,
    type HudLeftColumnPreviewProps,
  } from './hud-left-column.preview-fixtures';

  let { fleet = 'loaded' }: HudLeftColumnPreviewProps = $props();

  const fixture = createHudLeftColumnPreview();
  let nowMs = $state(0);

  $effect.pre(() => {
    const current = fleet;
    untrack(() => {
      nowMs = fixture.update(current);
    });
  });

  onDestroy(fixture.dispose);
</script>

<!-- The /hud route's 296px left rail, on its background. -->
<div class="hud-left-column-preview" data-preview-fleet={fleet}>
  <HudLeftColumn {nowMs} />
</div>

<style>
  .hud-left-column-preview {
    display: flex;
    flex-direction: column;
    width: 296px;
    min-height: 640px;
    padding: 14px;
    box-sizing: content-box;
    background: hsl(var(--background));
    color: hsl(var(--foreground));
  }
  .hud-left-column-preview > :global(*) {
    flex: 1;
  }
</style>
