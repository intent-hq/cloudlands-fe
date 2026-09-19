<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import DiagramActionsMenu from './DiagramActionsMenu.svelte';

  interface Props {
    kind: 'mermaid' | 'custom';
    children: Snippet;
    header?: Snippet;
    actions?: Snippet;
    actionsInTopMargin?: boolean;
    selected?: boolean;
    exportable?: boolean;
    fileName?: string;
  }

  let {
    kind,
    children,
    header,
    actions,
    actionsInTopMargin = false,
    selected = false,
    exportable = true,
    fileName,
  }: Props = $props();
  let contentElement: HTMLDivElement | undefined = $state();
  let noteWidth = $state<number>();
  let controlsWidth = $state<number>();

  onMount(() => {
    const lane = contentElement?.closest<HTMLElement>('.node-mermaidBlock, .node-diagram_block');
    const prose = lane?.parentElement;
    if (!lane || !prose?.matches('.tiptap-editor.ProseMirror') || !contentElement) return;
    const content = contentElement;
    let intrinsic = 0;
    const updateWidth = () => {
      const custom = content.querySelector<HTMLElement>('[data-diagram-intrinsic-width]');
      const svg = content.querySelector<SVGSVGElement>('.mermaid-svg > svg');
      // Read authored/layout dimensions, never the fitted screen rectangle: fitting
      // into this presentation must not feed back into its preferred width.
      if (custom?.dataset.diagramSettled === 'true') {
        intrinsic = Number(custom.dataset.diagramIntrinsicWidth);
      } else if (svg?.dataset.layoutSettled === 'true') {
        intrinsic = svg.viewBox.baseVal.width + 16;
      } else if (!custom && !svg) {
        intrinsic = 0;
      }
      noteWidth = Math.min(lane.clientWidth, Math.max(prose.clientWidth, intrinsic));
      controlsWidth = Math.min(lane.clientWidth, prose.clientWidth);
    };
    const resize = new ResizeObserver(updateWidth);
    resize.observe(lane);
    resize.observe(prose);
    const mutation = new MutationObserver(updateWidth);
    mutation.observe(content, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-diagram-settled', 'data-layout-settled'],
    });
    updateWidth();
    return () => {
      resize.disconnect();
      mutation.disconnect();
    };
  });
</script>

<section
  class="diagram-presentation"
  class:selected
  data-diagram-presentation
  data-diagram-kind={kind}
  style:width={noteWidth === undefined ? undefined : `${noteWidth}px`}
  style:min-width={noteWidth === undefined ? undefined : '0'}
  style={controlsWidth === undefined ? undefined : `--diagram-controls-width: ${controlsWidth}px`}
>
  {#if header}
    <header class="diagram-presentation-header" data-diagram-presentation-header>
      {@render header()}
    </header>
  {/if}

  {#if actions || exportable}
    <div
      class="diagram-presentation-actions"
      class:actions-in-top-margin={actionsInTopMargin}
      data-diagram-presentation-actions
    >
      {@render actions?.()}
      {#if exportable}
        <DiagramActionsMenu container={contentElement} {fileName} />
      {/if}
    </div>
  {/if}

  <div
    bind:this={contentElement}
    class="diagram-presentation-content"
    data-diagram-presentation-content
  >
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
    margin: 24px auto;
    overflow: visible;
    border: 0;
    background: transparent;
    color: hsl(var(--card-foreground));
    box-shadow: none;
  }

  :global([data-diagram-presentation] [data-diagram-presentation]) {
    margin-top: 0;
    margin-bottom: 0;
  }

  .diagram-presentation-header {
    min-width: 0;
    padding: var(--space-2) var(--space-3);
    font-family: var(--font-ui);
  }

  .diagram-presentation[data-diagram-kind='custom']:has(:global(.stateful-diagram))
    > .diagram-presentation-header {
    /* A scene's wider canvas must not unwrap the header and move its local footer. */
    width: min(100%, var(--diagram-controls-width, 100%));
    margin-inline: auto;
    box-sizing: border-box;
  }

  .diagram-presentation-content {
    min-width: 0;
    padding: var(--space-3);
    overflow: hidden;
    background: transparent;
  }

  .diagram-presentation[data-diagram-kind='custom']:has(:global(.stateful-diagram)) {
    width: 100%;
  }

  .diagram-presentation[data-diagram-kind='custom']:has(:global(.stateful-diagram))
    > .diagram-presentation-content {
    /* Keep canvas paint contained without intercepting the note's sticky scrollport. */
    overflow: clip;
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

  .diagram-presentation-actions.actions-in-top-margin {
    /* Note controls fit in the existing margin and content inset, above SVG paint.
       Keep them out of flow even while hidden; do not move the canvas on focus. */
    position: absolute;
    bottom: calc(100% - var(--space-3));
    inset-inline: 0;
    width: min(100%, var(--diagram-controls-width, 100%));
    margin-inline: auto;
    box-sizing: border-box;
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

  @container style(--motion-reduced: 1) {
    .diagram-presentation-actions,
    .diagram-presentation-actions :global(button) {
      transition: none;
    }
  }
</style>
