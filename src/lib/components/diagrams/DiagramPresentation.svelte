<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    kind: 'mermaid' | 'custom';
    children: Snippet;
    header?: Snippet;
    actions?: Snippet;
    selected?: boolean;
  }

  let { kind, children, header, actions, selected = false }: Props = $props();
</script>

<section
  class="diagram-presentation"
  class:selected
  data-diagram-presentation
  data-diagram-kind={kind}
>
  {#if header}
    <header class="diagram-presentation-header" data-diagram-presentation-header>
      {@render header()}
    </header>
  {/if}

  {#if actions}
    <div class="diagram-presentation-actions" data-diagram-presentation-actions>
      {@render actions()}
    </div>
  {/if}

  <div class="diagram-presentation-content" data-diagram-presentation-content>
    {@render children()}
  </div>
</section>

<style>
  .diagram-presentation {
    position: relative;
    box-sizing: border-box;
    width: fit-content;
    max-width: 100%;
    min-width: min(100%, 16rem);
    margin-block: var(--space-4);
    margin-inline: auto;
    overflow: hidden;
    border: 0;
    background: transparent;
    color: hsl(var(--card-foreground));
    box-shadow: none;
  }

  .diagram-presentation.selected {
    box-shadow: 0 0 0 1px hsl(var(--ring) / 0.28);
  }

  .diagram-presentation-header {
    min-width: 0;
    padding: var(--space-2) var(--space-3);
    font-family: var(--font-ui);
  }

  .diagram-presentation-content {
    min-width: 0;
    padding: var(--space-3);
    overflow: hidden;
    background: transparent;
  }

  .diagram-presentation-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--motion-fast) var(--ease-standard);
  }

  .diagram-presentation:hover .diagram-presentation-actions,
  .diagram-presentation:focus-within .diagram-presentation-actions {
    opacity: 1;
    pointer-events: auto;
  }

  .diagram-presentation-actions :global(button) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: var(--control-height-small);
    min-height: var(--control-height-small);
    padding: var(--space-1) var(--space-2);
    border: 1px solid hsl(var(--border) / 0.5);
    border-radius: var(--radius-small);
    background: hsl(var(--card) / 0.48);
    color: hsl(var(--muted-foreground));
    font-family: var(--font-ui);
    font-size: var(--text-caption-size);
    line-height: var(--text-caption-line-height);
    box-shadow: none;
    cursor: pointer;
    transition:
      color var(--motion-fast) var(--ease-standard),
      border-color var(--motion-fast) var(--ease-standard),
      background-color var(--motion-fast) var(--ease-standard);
  }

  .diagram-presentation-actions :global(button:hover) {
    border-color: hsl(var(--border));
    background: hsl(var(--muted) / 0.42);
    color: hsl(var(--foreground));
  }

  .diagram-presentation-actions :global(button:active) {
    background: hsl(var(--muted) / 0.58);
  }

  .diagram-presentation-actions :global(button:focus-visible) {
    outline: 2px solid hsl(var(--ring));
    outline-offset: 2px;
    border-color: hsl(var(--ring) / 0.7);
  }

  :global(.catalog-reduced-motion) .diagram-presentation-actions,
  :global(.catalog-reduced-motion) .diagram-presentation-actions :global(button) {
    transition: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .diagram-presentation-actions,
    .diagram-presentation-actions :global(button) {
      transition: none;
    }
  }
</style>
