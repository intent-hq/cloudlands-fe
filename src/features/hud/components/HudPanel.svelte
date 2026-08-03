<script lang="ts">
  /**
   * HUD panel frame — mock's bordered card with the small-caps title row
   * (title, hairline rule, optional right-aligned meta) above the body.
   */
  import type { Snippet } from 'svelte';

  let {
    title,
    fill = false,
    meta,
    children,
  }: {
    title: string;
    /** Stretch to absorb remaining column height (mock's ATTENTION slot). */
    fill?: boolean;
    /** Right-aligned header content (e.g. PASS badge, live dot). */
    meta?: Snippet;
    children: Snippet;
  } = $props();
</script>

<section class="hud-panel" class:hud-panel-fill={fill}>
  <header class="hud-panel-header">
    <span class="hud-panel-title">{title}</span>
    <span class="hud-panel-rule"></span>
    {#if meta}{@render meta()}{/if}
  </header>
  {@render children()}
</section>

<style>
  .hud-panel {
    border: 1px solid hsl(var(--border) / 0.8);
    background: hsl(var(--card) / 0.75);
  }
  .hud-panel-fill {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .hud-panel-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid hsl(var(--border) / 0.5);
  }
  .hud-panel-title {
    font:
      600 10px Inter,
      system-ui,
      sans-serif;
    letter-spacing: 0.18em;
    color: hsl(var(--text-subtle));
    text-transform: uppercase;
  }
  .hud-panel-rule {
    flex: 1;
    height: 1px;
    background: hsl(var(--border) / 0.6);
  }
</style>
