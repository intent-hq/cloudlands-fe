// i18n-ignore (internal unreleased preview controls and callback observations)
import { StrictMode, useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ExpandableFileSearch } from '@/components/workspace/sidebar/expandable-file-search';

export function FileSearchExamples() {
  const [mounted, setMounted] = useState(true);
  const [query, setQuery] = useState('');
  const [revision, setRevision] = useState(0);
  const [callbacks, setCallbacks] = useState(true);
  const [events, setEvents] = useState<object[]>([]);
  function record(event: object) {
    setEvents((previous) => [...previous, event]);
  }
  const frameRef = useRef<HTMLDivElement>(null);
  const recordBubble = useEffectEvent((event: KeyboardEvent) => record({ bubble: event.key }));
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    frame.addEventListener('keydown', recordBubble);
    return () => frame.removeEventListener('keydown', recordBubble);
  }, []);
  return (
    <section data-testid="file-search-demo" className="grid min-w-0 w-full gap-4">
      <header>
        <h2>File search</h2>
        <p className="type-caption text-muted-foreground">Internal React preview · unreleased</p>
      </header>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setQuery('external.ts')}>
          Set external query
        </Button>
        <Button variant="outline" onClick={() => setRevision((value) => value + 1)}>
          Update callback
        </Button>
        <Button variant="outline" onClick={() => setMounted(!mounted)}>
          {mounted ? 'Remove search' : 'Remount search'}
        </Button>
        <Button
          variant="outline"
          aria-pressed={!callbacks}
          onClick={() => setCallbacks(!callbacks)}
        >
          Omit callbacks
        </Button>
      </div>
      <div
        ref={frameRef}
        data-testid="file-search-frame"
        className="flex min-w-0 items-center gap-2"
      >
        {mounted && (
          <StrictMode>
            <ExpandableFileSearch
              query={query}
              onQueryChange={
                callbacks
                  ? (value) => {
                      setQuery(value);
                      record({ query: value, revision });
                    }
                  : undefined
              }
              onKeydown={
                callbacks
                  ? (event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        event.stopPropagation();
                      }
                      record({
                        key: event.key,
                        revision,
                        native: event instanceof KeyboardEvent,
                        target: event.currentTarget instanceof HTMLInputElement,
                        prevented: event.defaultPrevented,
                      });
                    }
                  : undefined
              }
            />
          </StrictMode>
        )}
      </div>
      <Button variant="outline">After file search</Button>
      <output aria-label="File search callbacks" className="min-w-0 break-words">
        {JSON.stringify(events)}
      </output>
    </section>
  );
}
