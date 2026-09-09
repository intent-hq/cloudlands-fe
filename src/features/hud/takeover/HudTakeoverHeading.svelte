<script lang="ts">
  /**
   * Takeover header heading — the hardware-key slot square (when held)
   * inline before the workspace title, with the repo ref underneath.
   * Purely presentational: the overlay owns the connected + slotted gate
   * and passes `keySlot` as null when the square must not render.
   */
  import HudKeySlotSquare from '../components/HudKeySlotSquare.svelte';

  let { title, repoRef, keySlot }: { title: string; repoRef: string; keySlot: number | null } =
    $props();
</script>

<div class="ov-heading">
  <div class="ov-title-row">
    {#if keySlot !== null}
      <HudKeySlotSquare slot={keySlot} class="ov-key-square" />
    {/if}
    <span class="ov-ws-name">{title}</span>
  </div>
  <span class="ov-ws-repo">{repoRef}</span>
</div>

<style>
  .ov-heading {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .ov-title-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  /* Hardware-key square scaled up to the 16px header title line. */
  .ov-title-row :global(.ov-key-square) {
    width: 22px;
    height: 22px;
    font-size: 12px;
  }
  .ov-ws-name {
    font:
      600 16px Inter,
      system-ui,
      sans-serif;
    letter-spacing: -0.02em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 380px;
  }
  .ov-ws-repo {
    font:
      500 10px 'JetBrains Mono',
      monospace;
    color: hsl(var(--muted-foreground));
  }
</style>
