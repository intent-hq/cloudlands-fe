// i18n-ignore (internal unreleased preview controls and brand names)
import { StrictMode, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ContextProviderIcon } from '@/features/context/components/context-provider-icon';
import {
  CONTEXT_ITEM_PROVIDERS,
  type ContextItemType,
  type ContextProvider,
} from '../../../../src/features/context/types';

const providers: ContextProvider[] = ['linear', 'github', 'sentry', 'browser', 'internal'];
const itemTypes = Object.keys(CONTEXT_ITEM_PROVIDERS) as ContextItemType[];
const sizes = [undefined, 0, 24, 47.5];

export function ContextProviderIconExamples() {
  const [provider, setProvider] = useState<ContextProvider | undefined>('linear');
  const [itemType, setItemType] = useState<ContextItemType>('github-issue');
  const [sizeIndex, setSizeIndex] = useState(0);
  const [mounted, setMounted] = useState(true);
  const [activations, setActivations] = useState<string[]>([]);
  return (
    <section className="grid w-lg max-w-full gap-4" data-testid="context-provider-demo">
      <header>
        <h2>Context provider icons</h2>
        <p className="type-caption text-muted-foreground">Internal React preview · unreleased</p>
      </header>
      <div className="flex flex-wrap gap-2" aria-label="Explicit provider">
        <Button variant="outline" aria-pressed={!provider} onClick={() => setProvider(undefined)}>
          Derive from item
        </Button>
        {providers.map((value) => (
          <Button
            key={value}
            variant="outline"
            aria-pressed={provider === value}
            onClick={() => setProvider(value)}
          >
            {value}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2" aria-label="Context item type">
        {itemTypes.map((value) => (
          <Button
            key={value}
            variant="outline"
            aria-pressed={itemType === value}
            onClick={() => setItemType(value)}
          >
            {value}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => setSizeIndex((value) => (value + 1) % sizes.length)}
        >
          Next size
        </Button>
        <Button
          variant="outline"
          aria-pressed={mounted}
          onClick={() => setMounted((value) => !value)}
        >
          Mount icon
        </Button>
      </div>
      <div
        className="flex min-h-24 items-center justify-center rounded-md bg-muted p-4"
        data-testid="context-provider-frame"
      >
        <StrictMode>
          {mounted && (
            <div data-testid="context-provider-current">
              <ContextProviderIcon
                provider={provider}
                itemType={itemType}
                size={sizes[sizeIndex]}
              />
            </div>
          )}
        </StrictMode>
      </div>
      <Button
        variant="outline"
        onClick={() =>
          setActivations((events) => [...events, `${provider ?? 'derived'}:${itemType}`])
        }
      >
        Activate current context
      </Button>
      <output>{JSON.stringify(activations)}</output>
    </section>
  );
}
