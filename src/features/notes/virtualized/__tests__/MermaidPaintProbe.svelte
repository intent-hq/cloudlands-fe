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
    };
  });
</script>

<!-- This full native construction fixture is not an active bounded reader. -->
<div
  bind:this={viewport}
  data-testid="native-paint-camera"
  style:background={dark ? '#171717' : '#ffffff'}
  style="width:256px;height:256px;overflow:hidden;position:relative"
>
  <div bind:this={construction} style="width:900px;transform-origin:0 0;transition-property:none">
    <MermaidRenderer
      {code}
      showExpandButton={false}
      showSourceButton={false}
      showExportButton={false}
    />
  </div>
</div>
