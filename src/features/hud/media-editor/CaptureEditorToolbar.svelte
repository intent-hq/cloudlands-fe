<script lang="ts">
  import type { Snippet } from 'svelte';

  let { label, children }: { label: string; children: Snippet } = $props();
</script>

<div class="capture-toolbar" role="group" aria-label={label}>
  {@render children()}
</div>

<style>
  /* Match the live feedback bar, independent of the editor window's appearance.
     Rebind only the control tokens; the surrounding editor keeps its own theme. */
  .capture-toolbar {
    --primary: var(--theme-dark-primary);
    --foreground: var(--theme-dark-foreground);
    --muted-foreground: var(--theme-dark-muted-foreground);
    --border: var(--theme-dark-border);
    --hover: var(--theme-dark-hover);
    --active: var(--theme-dark-active);
    /* Tailwind color aliases otherwise resolve at the host theme boundary. */
    --color-foreground: hsl(var(--foreground));
    --color-muted-foreground: hsl(var(--muted-foreground));
    --color-hover: var(--hover);
    --color-active: var(--active);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 4px;
    width: fit-content;
    max-width: 100%;
    padding: 4px;
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-large);
    background: hsl(var(--theme-dark-surface-3));
    color: hsl(var(--foreground));
    box-shadow: 0 8px 24px var(--theme-dark-shadow-drop);
    -webkit-app-region: no-drag;
  }
  .capture-toolbar :global(button[aria-pressed='true']) {
    color: hsl(var(--primary));
  }
  .capture-toolbar :global(button[aria-pressed='true'] [data-slot='button-surface']) {
    background: hsl(var(--primary) / 0.2);
    box-shadow: none;
  }
  .capture-toolbar :global(button:focus-visible) {
    outline: 2px solid hsl(var(--primary));
    outline-offset: 2px;
  }
  .capture-toolbar :global(.capture-tool-separator) {
    width: 1px;
    height: 20px;
    flex: none;
    margin-inline: 4px;
    background: hsl(var(--border));
  }
</style>
