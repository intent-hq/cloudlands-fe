// Source: ContentFieldCatalogPreview.svelte, loading-indicator branch.
// i18n-ignore (reference catalog fixture content)
import { IntentMarkLoader } from '@/components/ui/indicators';
import { intentMarkVariants } from '$lib/components/ui/indicators/intent-mark-motion';
import { Button } from '@/components/ui/button';
import { ListContainer, ListItem } from '@/components/ui/list';
import type { UiComponentFixture } from '$lib/components/ui/component-metadata';
export function IndicatorCatalogPreview({ fixture }: { fixture: UiComponentFixture }) {
  return (
    <div
      className="grid w-full min-w-0 max-w-2xl grid-cols-1 gap-4 overflow-hidden"
      data-catalog-renderer-fixture={fixture.id}
    >
      <div
        className="grid gap-2"
        data-catalog-rendered-state="bloom pulse twist light dark reduced-motion"
      >
        {intentMarkVariants.map((variant) => (
          <div key={variant} className="flex items-center gap-3" data-loader-variant={variant}>
            <span className="type-caption w-14 capitalize text-muted-foreground">{variant}</span>
            <IntentMarkLoader variant={variant} size={24} />
          </div>
        ))}
      </div>
      <div className="grid gap-2" data-catalog-rendered-state="size-16 size-24 size-32">
        <span className="type-caption text-muted-foreground">Bloom sizes</span>
        <div className="flex items-center gap-4">
          {[16, 24, 32].map((size) => (
            <div key={size} className="flex items-center gap-1.5" data-loader-size={size}>
              <IntentMarkLoader variant="bloom" size={size} />
              <span className="type-caption text-muted-foreground">{size}</span>
            </div>
          ))}
        </div>
      </div>
      <div
        className="flex items-center gap-3"
        data-catalog-rendered-state="paused"
        data-loader-paused
      >
        <IntentMarkLoader variant="bloom" size={16} playing={false} />
        <span className="type-caption text-muted-foreground">
          Paused and reduced-motion frames keep the full mark at 16 px.
        </span>
      </div>
      <div className="grid gap-3" data-catalog-rendered-state="in-button in-list-row">
        <div className="grid gap-1.5" data-loader-context="button">
          <span className="type-caption text-muted-foreground">Button loading</span>
          <Button loading>Button loading</Button>
        </div>
        <div className="grid gap-1.5" data-loader-context="list-row">
          <span className="type-caption text-muted-foreground">ListItem loading</span>
          <ListContainer>
            <ListItem title="Loading workspace" loading />
          </ListContainer>
        </div>
      </div>
    </div>
  );
}
