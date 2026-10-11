// i18n-ignore (internal image/presentation exercise controls, not released product copy)
import { useRef, useState } from 'react';
import { ResourceIconTile } from '@/components/shared/resource-icon-tile';
import { BrowserFavicon } from '@/components/layout/panel-system/browser-favicon';
import { FormField } from '@/components/patterns/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

function ResourceTileExample() {
  const [kind, setKind] = useState<'note' | 'changes'>('note');
  const [variant, setVariant] = useState<'default' | 'standard' | 'emphasized'>('default');
  return (
    <section className="grid min-w-0 gap-4" data-functional-example="resource-icon-tile">
      <h2>Resource icon tile inputs</h2>
      <FormField
        label="Resource kind"
        control={(field) => (
          <ToggleGroup
            {...field}
            type="single"
            aria-label="Resource kind"
            className="flex-wrap justify-start"
            value={kind}
            onValueChange={(next) => {
              if (next === 'note' || next === 'changes') setKind(next);
            }}
          >
            <ToggleGroupItem value="note">Note</ToggleGroupItem>
            <ToggleGroupItem value="changes">Changes</ToggleGroupItem>
          </ToggleGroup>
        )}
      />
      <FormField
        label="Resource variant"
        control={(field) => (
          <ToggleGroup
            {...field}
            type="single"
            aria-label="Resource variant"
            className="flex-wrap justify-start"
            value={variant}
            onValueChange={(next) => {
              if (next === 'default' || next === 'standard' || next === 'emphasized')
                setVariant(next);
            }}
          >
            <ToggleGroupItem value="default">Default</ToggleGroupItem>
            <ToggleGroupItem value="standard">Standard</ToggleGroupItem>
            <ToggleGroupItem value="emphasized">Emphasized</ToggleGroupItem>
          </ToggleGroup>
        )}
      />
      <div data-testid="resource-tile-target">
        <ResourceIconTile kind={kind} variant={variant === 'default' ? undefined : variant} />
      </div>
      <output aria-label="Resource tile inputs">{JSON.stringify({ kind, variant })}</output>
      <p className="type-caption text-muted-foreground">
        Both kinds are decorative. Default omits the variant prop. Browser forced-colors mode
        exercises the component’s existing system-color treatment.
      </p>
    </section>
  );
}

// Existing public bytes served from root static/ by apps/react/vite.config.ts.
// The missing URL is intentionally absent; runtime-config.js is real non-image content.
const imageUrls = {
  none: undefined,
  favicon: '/favicon.png',
  ios: '/icons/Icon-iOS-Default-68x68@2x.png',
  missing: '/__catalog_missing_favicon__.png',
  'non-image': '/runtime-config.js',
};
type ImageObservation = {
  node: number;
  src: string | null;
  currentSrc: string;
  complete: boolean;
  naturalWidth: number;
  naturalHeight: number;
  width: number;
  height: number;
  opacity: string;
} | null;

function FaviconExample() {
  const [source, setSource] = useState<keyof typeof imageUrls>('none');
  const [customSize, setCustomSize] = useState(false);
  const [size, setSize] = useState(32);
  const [foreground, setForeground] = useState(false);
  const [observations, setObservations] = useState<ImageObservation[]>([]);
  const target = useRef<HTMLDivElement>(null);
  const identities = useRef(new WeakMap<HTMLImageElement, number>());
  const nextIdentity = useRef(1);
  function inspectImage() {
    const image = target.current?.querySelector('img');
    if (!image) {
      setObservations((previous) => [...previous, null]);
      return;
    }
    let node = identities.current.get(image);
    if (node === undefined) {
      node = nextIdentity.current++;
      identities.current.set(image, node);
    }
    const observation = {
      node,
      src: image.getAttribute('src'),
      currentSrc: image.currentSrc,
      complete: image.complete,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      width: image.width,
      height: image.height,
      opacity: getComputedStyle(image).opacity,
    };
    setObservations((previous) => [...previous, observation]);
  }
  return (
    <section className="grid min-w-0 gap-4" data-functional-example="browser-favicon">
      <h2>Browser favicon image lifecycle</h2>
      <FormField
        label="Favicon source"
        control={(field) => (
          <ToggleGroup
            {...field}
            type="single"
            aria-label="Favicon source"
            className="flex-wrap justify-start"
            value={source}
            onValueChange={(next) => {
              if (
                next === 'none' ||
                next === 'favicon' ||
                next === 'ios' ||
                next === 'missing' ||
                next === 'non-image'
              )
                setSource(next);
            }}
          >
            <ToggleGroupItem value="none">No URL</ToggleGroupItem>
            <ToggleGroupItem value="favicon">App PNG</ToggleGroupItem>
            <ToggleGroupItem value="ios">iOS PNG</ToggleGroupItem>
            <ToggleGroupItem value="missing">Missing URL</ToggleGroupItem>
            <ToggleGroupItem value="non-image">Non-image URL</ToggleGroupItem>
          </ToggleGroup>
        )}
      />
      <FormField
        label="Custom favicon size"
        control={(field) => (
          <Switch {...field} checked={customSize} onCheckedChange={setCustomSize} />
        )}
      />
      <FormField
        label="Favicon size"
        control={(field) => (
          <Input
            {...field}
            type="number"
            min={1}
            max={128}
            value={size}
            onChange={(event) => {
              const next = event.currentTarget.valueAsNumber;
              if (next >= 1 && next <= 128) setSize(next);
            }}
          />
        )}
      />
      <FormField
        label="Foreground fallback"
        control={(field) => (
          <Switch {...field} checked={foreground} onCheckedChange={setForeground} />
        )}
      />
      <div ref={target} data-testid="favicon-target">
        <BrowserFavicon
          faviconUrl={imageUrls[source]}
          size={customSize ? size : undefined}
          fallbackClass={foreground ? 'text-foreground' : undefined}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={inspectImage}>Inspect rendered image</Button>
        <Button onClick={() => setObservations([])}>Clear image observations</Button>
      </div>
      <output aria-label="Favicon inputs" className="wrap-anywhere">
        {JSON.stringify({
          source,
          faviconUrl: imageUrls[source] ?? null,
          size: customSize ? size : 'default (16)',
          fallbackClass: foreground ? 'text-foreground' : 'default',
        })}
      </output>
      <output aria-label="Favicon observations" className="wrap-anywhere">
        {JSON.stringify(observations)}
      </output>
      <p className="type-caption text-muted-foreground">
        Inspect reads the current native image without changing it: null means no image; a loaded
        image has nonzero natural dimensions. Complete alone also includes failed loads. Node
        numbers identify observed DOM elements and survive clearing this log. Compare two
        inspections around a URL change or same-URL size change.
      </p>
      <p className="type-caption text-muted-foreground">
        The two PNGs are existing public assets. Missing and non-image URLs fail naturally. No
        requests or image events are intercepted or synthesized. The underlying globe remains
        present; the image’s native load/error handlers control its visibility. Both are decorative.
      </p>
    </section>
  );
}

export function ResourceIconExamples({ slug }: { slug: string }) {
  return (
    <div className="grid w-full min-w-0 max-w-full gap-4">
      <p className="type-caption text-muted-foreground">
        Internal leaf exercise. Source panel-tab-strip and panel-header-actions fixtures contain no
        loaded favicon URL. This supplemental page does not prove panel integration or source
        appearance parity.
      </p>
      {slug === 'resource-icon-tile' && <ResourceTileExample />}
      {slug === 'browser-favicon' && <FaviconExample />}
    </div>
  );
}
