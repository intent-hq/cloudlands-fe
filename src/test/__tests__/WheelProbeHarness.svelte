<!-- Fixture for ct-wheel.ct.spec.ts: a two-axis scroll container and a short static box. -->
<script lang="ts">
  let { dropWheels = 0 }: { dropWheels?: number } = $props();

  let scroller: HTMLDivElement;
  let received = $state(0);
  let dropped = $state(0);

  // Cancelling a wheel stops the scroll it would cause, like a wheel Chromium dropped.
  // Attached manually because Svelte registers `onwheel` as passive.
  $effect(() => {
    const onWheel = (event: WheelEvent) => {
      received++;
      if (dropped < dropWheels) {
        dropped++;
        event.preventDefault();
      }
    };
    scroller.addEventListener('wheel', onWheel, { passive: false });
    return () => scroller.removeEventListener('wheel', onWheel);
  });
</script>

<div
  bind:this={scroller}
  data-testid="scroller"
  data-wheels-received={received}
  data-wheels-dropped={dropped}
  style="width: 200px; height: 200px; overflow: auto;"
>
  <div style="width: 1000px; height: 1000px;"></div>
</div>
<div data-testid="static" style="width: 200px; height: 100px; overflow: auto;">
  <div style="height: 50px;"></div>
</div>
