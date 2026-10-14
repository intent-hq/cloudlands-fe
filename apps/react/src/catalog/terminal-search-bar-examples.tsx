// i18n-ignore (internal unreleased component preview controls and caller values)
import { useRef, useState } from 'react';
import { TerminalSearchBar } from '@/components/terminal/terminal-search-bar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function TerminalSearchBarExamples() {
  const [open, setOpen] = useState(false);
  const [seed, setSeed] = useState('  alpha  ');
  const [trigger, setTrigger] = useState(0);
  const [updated, setUpdated] = useState(false);
  const [matches, setMatches] = useState(true);
  const [mounted, setMounted] = useState(true);
  const [retire, setRetire] = useState(false);
  const [events, setEvents] = useState<
    { kind: string; query: string; revision: string; visibleQuery: string | null }[]
  >([]);
  const frame = useRef<HTMLDivElement>(null);
  const revision = updated ? 'updated' : 'original';
  function record(kind: string, query: string) {
    const visibleQuery = frame.current?.querySelector('input')?.value ?? null;
    setEvents((previous) => [...previous, { kind, query, revision, visibleQuery }]);
    if (retire) setOpen(false);
  }
  return (
    <section className="grid min-w-0 w-full max-w-lg gap-4" data-testid="terminal-search-demo">
      <header>
        <h2>Terminal search bar</h2>
        <p className="type-caption text-muted-foreground">Internal React preview · unreleased</p>
      </header>
      <Input
        aria-label="Seed query"
        value={seed}
        onChange={(event) => setSeed(event.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setOpen(!open)}>
          {open ? 'Close search' : 'Open search'}
        </Button>
        <Button variant="outline" onClick={() => setTrigger(trigger + 1)}>
          New focus trigger
        </Button>
        <Button variant="outline" onClick={() => setUpdated(!updated)}>
          Replace callbacks
        </Button>
        <Button variant="outline" aria-pressed={!matches} onClick={() => setMatches(!matches)}>
          No matches
        </Button>
        <Button variant="outline" aria-pressed={retire} onClick={() => setRetire(!retire)}>
          Close on find
        </Button>
        <Button variant="outline" aria-pressed={mounted} onClick={() => setMounted(!mounted)}>
          Mount search owner
        </Button>
      </div>
      <div ref={frame} data-testid="terminal-search-frame" className="relative min-h-20 min-w-0">
        {mounted && (
          <TerminalSearchBar
            isOpen={open}
            initialQuery={seed}
            focusTrigger={trigger}
            hasMatches={matches}
            currentMatchIndex={matches ? 1 : -1}
            totalMatches={matches ? 3 : 0}
            onFindNext={(query) => record('next', query)}
            onFindPrevious={(query) => record('previous', query)}
            onClose={() => {
              record('close', '');
              setOpen(false);
            }}
          />
        )}
      </div>
      <output aria-label="Terminal search callbacks" className="min-w-0 break-words">
        {JSON.stringify(events)}
      </output>
    </section>
  );
}
