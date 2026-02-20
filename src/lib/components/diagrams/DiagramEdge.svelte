<script lang="ts">
  /**
   * Diagram Edge Component
   */
  import type { ComputedEdge } from './types';
  import { invoke } from '$lib/electron-bridge';
  import { createLogger } from '$lib/utils/client-logger';

  interface Props {
    edge: ComputedEdge;
    dimmed?: boolean;
  }

  let { edge, dimmed = false }: Props = $props();
  const logger = createLogger('DiagramEdge');

  // Handle binding click
  async function handleClick() {
    if (edge.bindings && edge.bindings.length > 0) {
      const binding = edge.bindings[0];
      try {
        switch (binding.type) {
          case 'file':
            await invoke('workspace:openFile', { filePath: binding.target });
            break;
          case 'symbol':
            await invoke('workspace:openSymbol', { symbolId: binding.target });
            break;
          case 'spec':
            await invoke('workspace:openSpec', { specId: binding.target });
            break;
          case 'note':
            await invoke('workspace:openNote', { noteId: binding.target });
            break;
          case 'timeline_event':
            await invoke('workspace:openTimelineEvent', { eventId: binding.target });
            break;
          case 'metric':
            await invoke('workspace:openMetric', { metricId: binding.target });
            break;
          case 'log':
            await invoke('workspace:openLog', { logId: binding.target });
            break;
          case 'test':
            await invoke('workspace:openTest', { testId: binding.target });
            break;
        }
      } catch {
        // In browser, IPC is not available
        logger.debug('Would open binding (browser mode)', {
          type: binding.type,
          target: binding.target,
        });
      }
    }
  }

  // Get edge class based on semantic style
  let edgeClass = $derived.by(() => {
    const classes = ['diagram-edge'];
    if (edge.semanticStyle) {
      classes.push(`edge-${edge.semanticStyle}`);
    }
    if (edge.animated) {
      classes.push('edge-animated');
    }
    if (edge.dashed) {
      classes.push('edge-dashed');
    }
    if (edge.bindings && edge.bindings.length > 0) {
      classes.push('edge-clickable');
    }
    if (dimmed) {
      classes.push('edge-dimmed');
    }
    return classes.join(' ');
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<g class={edgeClass} onclick={handleClick}>
  <!-- Edge path -->
  <path
    d={edge.path}
    class="edge-path"
    marker-end="url(#arrowhead)"
    vector-effect="non-scaling-stroke"
  />
</g>

<!-- Marker definitions -->
<defs>
  <!-- Chevron arrow at end -->
  <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
    <path
      d="M 3 1 L 8 5 L 3 9"
      fill="none"
      stroke="hsl(var(--border))"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      vector-effect="non-scaling-stroke"
    />
  </marker>
</defs>

<style>
  :global(.edge-path) {
    fill: none;
    stroke: hsl(var(--border));
    stroke-width: 1px;
    transition: all 0.2s ease;
  }

  :global(.edge-clickable) {
    cursor: pointer;
  }

  :global(.diagram-edge:hover .edge-path) {
    stroke: hsl(var(--foreground) / 0.7);
    stroke-width: 1px;
  }

  :global(.edge-dimmed .edge-path) {
    opacity: 0.15;
    transition: opacity 0.2s ease;
  }

  :global(.edge-highlighted .edge-path) {
    stroke: hsl(var(--accent));
    stroke-width: 1px;
  }

  :global(.edge-muted .edge-path) {
    stroke: hsl(var(--muted-foreground) / 0.3);
    stroke-width: 1px;
  }

  :global(.edge-danger .edge-path) {
    stroke: hsl(var(--destructive) / 0.6);
    stroke-width: 1px;
  }

  :global(.edge-success .edge-path) {
    stroke: hsl(142 76% 36% / 0.6);
    stroke-width: 1px;
  }

  :global(.edge-warning .edge-path) {
    stroke: hsl(38 92% 50% / 0.6);
    stroke-width: 1px;
  }

  :global(.edge-inactive .edge-path) {
    stroke: hsl(var(--muted-foreground) / 0.2);
    stroke-width: 1px;
  }

  :global(.edge-active .edge-path) {
    stroke: hsl(var(--accent));
    stroke-width: 1px;
  }

  /* Dashed edge style */
  :global(.edge-dashed .edge-path) {
    stroke-dasharray: 5 4;
  }

  /* Animated flow */
  :global(.edge-animated .edge-path) {
    stroke-dasharray: 6 4;
    animation: dash-flow 1s linear infinite;
  }

  @keyframes dash-flow {
    to {
      stroke-dashoffset: -10;
    }
  }
</style>
