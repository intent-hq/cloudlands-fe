// Source: ProximityHighlightCatalogPreview.svelte.
// i18n-ignore (reference catalog fixture content)
import { useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ProximityHighlight, createProximityHover, type ProximityHover } from '@/lib/interaction';
import type { UiComponentFixture } from '$lib/components/ui/component-metadata';

export function ProximityCatalogPreview({ fixture }: { fixture: UiComponentFixture }) {
  const container = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<ProximityHover>();
  useLayoutEffect(() => {
    if (!container.current) return;
    const instance = createProximityHover(container.current);
    container.current
      .querySelectorAll('button')
      .forEach((row, index) => instance.registerItem(index, row));
    instance.setActiveIndex(0);
    setHover(instance);
    return () => instance.destroy();
  }, []);
  return (
    <div
      ref={container}
      className="relative grid w-64 gap-1"
      data-catalog-renderer-fixture={fixture.id}
      data-catalog-rendered-state="pointer-proximity keyboard-focus selected merged-selection reduced-motion"
    >
      {hover && <ProximityHighlight store={hover} selectedIndexes={[1, 2]} />}
      {['Nearest row', 'Selected row', 'Merged selection'].map((label, index) => (
        <Button
          key={label}
          variant="plain"
          className="relative z-10 h-8 rounded-(--radius-small) px-2 text-left text-sm"
          onFocus={() => hover?.setActiveIndex(index)}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}
