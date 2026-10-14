// i18n-ignore (internal unreleased component preview controls and caller values)
import { useState } from 'react';
import { TimeScrubber } from '@/components/agent-overview/time-scrubber';
import { Button } from '@/components/ui/button';

const start = '2026-01-01T00:00:00.000Z';
const middle = '2026-01-01T00:00:05.000Z';
const end = '2026-01-01T00:00:10.000Z';

export function TimeScrubberExamples() {
  const [currentTime, setCurrentTime] = useState(middle);
  const [isLive, setLive] = useState(false);
  const [range, setRange] = useState<'valid' | 'equal' | 'reversed'>('valid');
  const [hold, setHold] = useState(false);
  const [updated, setUpdated] = useState(false);
  const [visible, setVisible] = useState(true);
  const [events, setEvents] = useState<{ kind: string; time: string; revision: string }[]>([]);
  const revision = updated ? 'updated' : 'original';
  return (
    <section className="grid min-w-0 w-full max-w-3xl gap-4" data-testid="time-scrubber-demo">
      <header>
        <h2>Timeline scrubber</h2>
        <p className="type-caption text-muted-foreground">Internal React preview · unreleased</p>
      </header>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" aria-pressed={hold} onClick={() => setHold(!hold)}>
          Hold caller time
        </Button>
        <Button variant="outline" onClick={() => setCurrentTime('2026-01-01T00:00:07.000Z')}>
          Publish seven seconds
        </Button>
        <Button variant="outline" onClick={() => setUpdated(!updated)}>
          Replace callbacks
        </Button>
        <Button variant="outline" onClick={() => setRange('equal')}>
          Equal range
        </Button>
        <Button variant="outline" onClick={() => setRange('reversed')}>
          Reversed range
        </Button>
        <Button variant="outline" onClick={() => setRange('valid')}>
          Restore range
        </Button>
        <Button variant="outline" aria-pressed={visible} onClick={() => setVisible(!visible)}>
          Show scrubber
        </Button>
      </div>
      <div data-testid="time-scrubber-frame" className="min-w-0">
        {visible && (
          <TimeScrubber
            currentTime={currentTime}
            minTime={range === 'reversed' ? end : start}
            maxTime={range === 'valid' ? end : start}
            isLive={isLive}
            onTimeChange={(time) => {
              setEvents((previous) => [...previous, { kind: 'seek', time, revision }]);
              setLive(false);
              if (!hold) setCurrentTime(time);
            }}
            onGoLive={() => {
              setEvents((previous) => [...previous, { kind: 'live', time: end, revision }]);
              setLive(true);
              setCurrentTime(end);
            }}
          />
        )}
      </div>
      <output aria-label="Caller time">{currentTime}</output>
      <output aria-label="Scrubber callbacks" className="min-w-0 break-words">
        {JSON.stringify(events)}
      </output>
    </section>
  );
}
