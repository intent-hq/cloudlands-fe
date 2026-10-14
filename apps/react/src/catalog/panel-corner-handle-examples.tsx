// i18n-ignore (internal migration drag-lifetime preview)
import { StrictMode, useState } from 'react';
import { Button } from '@/components/ui/button';
import { PanelCornerHandle } from '@/components/layout/panel-system/panel-corner-handle';

export function PanelCornerHandleExamples() {
  const [shown, setShown] = useState(true);
  const [revision, setRevision] = useState(1);
  const [retire, setRetire] = useState<'never' | 'start' | 'move'>('never');
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [events, setEvents] = useState<
    { kind: string; revision: number; x?: number; y?: number }[]
  >([]);
  const record = (kind: string, x?: number, y?: number) => {
    setEvents((previous) => [
      ...previous,
      { kind, revision, ...(x === undefined ? {} : { x, y }) },
    ]);
  };

  return (
    <section className="grid min-w-0 gap-4" data-testid="panel-corner-demo">
      <header>
        <h2>Panel corner resize</h2>
        <p className="type-caption text-muted-foreground">Internal pointer and lifetime preview</p>
      </header>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setRevision((value) => value + 1)}>
          Replace callbacks
        </Button>
        <Button
          variant="outline"
          aria-pressed={retire === 'start'}
          onClick={() => setRetire(retire === 'start' ? 'never' : 'start')}
        >
          Retire on start
        </Button>
        <Button
          variant="outline"
          aria-pressed={retire === 'move'}
          onClick={() => setRetire(retire === 'move' ? 'never' : 'move')}
        >
          Retire on move
        </Button>
        <Button variant="outline" onClick={() => setShown(!shown)}>
          {shown ? 'Unmount handle' : 'Mount handle'}
        </Button>
      </div>
      <Button variant="outline">Before resize handle</Button>
      <div
        className="relative h-64 w-full border border-border bg-background"
        data-testid="panel-corner-frame"
      >
        <iframe
          title="Local resize target"
          tabIndex={-1}
          className="absolute right-4 top-4 h-20 w-32 border border-border"
          srcDoc="<!doctype html><title>Local frame</title><p>Local frame target</p>"
        />
        <div className="absolute bottom-4 left-4 type-caption text-muted-foreground">
          Drag the corner
        </div>
        {shown && (
          <StrictMode>
            <PanelCornerHandle
              style={`left: calc(40% + ${offset.x}px); top: calc(55% + ${offset.y}px);`}
              onResizeStart={() => {
                record('start');
                if (retire === 'start') setShown(false);
              }}
              onResize={(x, y) => {
                record('move', x, y);
                setOffset((previous) => ({ x: previous.x + x, y: previous.y + y }));
                if (retire === 'move') setShown(false);
              }}
              onResizeEnd={() => record('end')}
            />
          </StrictMode>
        )}
      </div>
      <Button variant="outline">After resize handle</Button>
      <output aria-label="Resize callbacks" className="min-w-0 break-words">
        {JSON.stringify({ offset, events })}
      </output>
    </section>
  );
}
