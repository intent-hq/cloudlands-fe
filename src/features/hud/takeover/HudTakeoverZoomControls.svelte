<script lang="ts">
  /**
   * Takeover map zoom controls — the bottom-right fit / − / + / 100%
   * cluster over the map viewport. Rendered as a sibling of .ov-map-clip
   * (OUTSIDE the drag clip), so button clicks never reach the drag /
   * click-suppression handlers; in/out disable at the zoom range limits.
   */
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';
  import type { HudTakeoverMapState } from './hud-takeover-map.svelte';

  let { map }: { map: HudTakeoverMapState } = $props();
</script>

<div
  class="ov-map-zoom"
  role="group"
  aria-label={m.hud_takeover_zoom_ariaLabel()}
  data-testid="hud-takeover-zoom"
>
  <Button
    class="ov-map-zoom-btn"
    onclick={() => map.zoomFit()}
    aria-label={m.hud_takeover_zoomFit_ariaLabel()}
    title={m.hud_takeover_zoomFit_ariaLabel()}
    data-testid="hud-takeover-zoom-fit"
  >
    {m.hud_takeover_zoomFit_label()}
  </Button>
  <Button
    class="ov-map-zoom-btn"
    onclick={() => map.zoomOut()}
    disabled={!map.canZoomOut}
    aria-label={m.hud_takeover_zoomOut_ariaLabel()}
    title={m.hud_takeover_zoomOut_ariaLabel()}
    data-testid="hud-takeover-zoom-out"
  >
    {m.hud_takeover_zoomOut_label()}
  </Button>
  <Button
    class="ov-map-zoom-btn"
    onclick={() => map.zoomIn()}
    disabled={!map.canZoomIn}
    aria-label={m.hud_takeover_zoomIn_ariaLabel()}
    title={m.hud_takeover_zoomIn_ariaLabel()}
    data-testid="hud-takeover-zoom-in"
  >
    {m.hud_takeover_zoomIn_label()}
  </Button>
  <Button
    class="ov-map-zoom-btn"
    onclick={() => map.zoomReset()}
    aria-label={m.hud_takeover_zoomReset_ariaLabel()}
    title={m.hud_takeover_zoomReset_ariaLabel()}
    data-testid="hud-takeover-zoom-reset"
  >
    {m.hud_takeover_zoomReset_label()}
  </Button>
</div>

<style>
  /* Zoom cluster: above the (pointer-events: none) banners, inset from the
     clip's bottom-right corner in the mock's monospace button style. */
  .ov-map-zoom {
    position: absolute;
    right: 30px;
    bottom: 32px;
    z-index: 2;
    display: flex;
    gap: 6px;
  }
  /* Unlayered scoped CSS intentionally outranks the Button primitive's
     layered Tailwind utilities to keep the takeover HUD's monospace look. */
  .ov-map-zoom :global(.ov-map-zoom-btn) {
    cursor: pointer;
    height: auto;
    border: 1px solid hsl(var(--border));
    border-radius: 0;
    background: hsl(var(--card) / 0.92);
    min-width: 28px;
    padding: 5px 9px;
    font:
      600 10px 'JetBrains Mono',
      monospace;
    letter-spacing: 0.08em;
    color: hsl(var(--muted-foreground));
    text-transform: uppercase;
  }
  .ov-map-zoom :global(.ov-map-zoom-btn:hover:not(:disabled)) {
    border-color: hsl(var(--border));
    background: hsl(var(--muted) / 0.5);
    color: hsl(var(--muted-foreground));
  }
  .ov-map-zoom :global(.ov-map-zoom-btn:disabled) {
    cursor: default;
    pointer-events: auto;
    opacity: 0.35;
  }
</style>
