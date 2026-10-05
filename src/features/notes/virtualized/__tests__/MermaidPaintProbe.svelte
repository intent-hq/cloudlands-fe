<script lang="ts">
  import { onMount } from 'svelte';
  import MermaidRenderer from '$lib/components/markdown/MermaidRenderer.svelte';
  import { probeNativeMermaidPaint } from './mermaid-paint-probe';
  let { code, dark = false }: { code: string; dark?: boolean } = $props();
  let viewport: HTMLDivElement;
  let construction: HTMLDivElement;
  onMount(() => {
    document.documentElement.classList.toggle('dark', dark);
    Object.assign(viewport, {
      paint: (target: 'first' | 'far', scale: number) =>
        probeNativeMermaidPaint(viewport, construction, target, scale),
    });
    return () => {
      Reflect.deleteProperty(viewport, 'paint');
      Reflect.deleteProperty(viewport, 'paintSnapshot');
    };
  });
</script>

<!-- This full native construction fixture is not an active bounded reader. -->
<!-- Paint both references offscreen: an opaque DOM screenshot can use LCD text
     antialiasing, while an SVG image drawn to canvas uses grayscale coverage. -->
<div
  bind:this={viewport}
  data-testid="native-paint-camera"
  style:background={dark ? '#171717' : '#ffffff'}
  style="width:256px;height:256px;overflow:hidden;position:relative;filter:opacity(1)"
>
  <div
    bind:this={construction}
    data-testid="native-paint-construction"
    style="width:900px;transform-origin:0 0;transition-property:none"
  >
    <MermaidRenderer
      {code}
      showExpandButton={false}
      showSourceButton={false}
      showExportButton={false}
    />
  </div>
</div>

<style>
  /* Centering an odd-width SVG introduces a half-pixel source origin. The tile
     image starts at zero, so keep this comparison's native origin on that grid. */
  [data-testid='native-paint-camera'] :global(.mermaid-svg) {
    justify-content: flex-start;
  }
</style>
