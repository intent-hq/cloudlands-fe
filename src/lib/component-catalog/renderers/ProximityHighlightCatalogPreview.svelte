<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { ProximityHighlight } from '$lib/components/ui/proximity-highlight';
  import type { ProximityHover } from '$lib/interaction';
  import type { CatalogRendererProps } from '../catalog-renderers';

  let { fixture }: CatalogRendererProps = $props();
  let activeIndex = $state<number | null>(0);
  let sessionId = $state(1);
  const itemRects = [
    { top: 0, left: 0, width: 256, height: 32 },
    { top: 36, left: 0, width: 256, height: 32 },
    { top: 72, left: 0, width: 256, height: 32 },
  ];
  const store: ProximityHover = {
    get activeIndex() {
      return activeIndex;
    },
    get itemRects() {
      return itemRects;
    },
    get pointerPosition() {
      return null;
    },
    get sessionId() {
      return sessionId;
    },
    measure() {},
    setActiveIndex(index) {
      activeIndex = index;
      sessionId += 1;
    },
    registerItem() {},
    destroy() {},
  };
</script>

<div
  class="relative grid w-64 gap-1"
  data-catalog-renderer-fixture={fixture.id}
  data-catalog-rendered-state="pointer-proximity keyboard-focus selected merged-selection reduced-motion"
>
  <ProximityHighlight {store} selectedIndexes={[1, 2]} />
  {#each ['Nearest row', 'Selected row', 'Merged selection'] as label, index}
    <Button
      variant="plain"
      class="relative z-10 h-8 rounded-(--radius-small) px-2 text-left text-sm"
      onpointerenter={() => store.setActiveIndex(index)}
      onpointerleave={() => store.setActiveIndex(null)}
      onfocus={() => store.setActiveIndex(index)}>{label}</Button
    >
  {/each}
</div>
