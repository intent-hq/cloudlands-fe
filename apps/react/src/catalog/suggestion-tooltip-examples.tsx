// i18n-ignore (internal unreleased component preview controls and suggestion content)
import { StrictMode, useState } from 'react';
import { Button } from '@/components/ui/button';
import { SuggestionTooltip } from '@/components/tiptap/suggestion-tooltip';
import '../../../../src/lib/styles/tiptap-editor.css';

export function SuggestionTooltipExamples() {
  const [type, setType] = useState<'addition' | 'deletion' | 'modification'>('modification');
  const [revision, setRevision] = useState(1);
  const [details, setDetails] = useState(true);
  const [moved, setMoved] = useState(false);
  const [callbacks, setCallbacks] = useState(true);
  const [retire, setRetire] = useState(false);
  const [shown, setShown] = useState(true);
  const [events, setEvents] = useState<{ action: string; id: string; revision: number }[]>([]);
  function record(action: string, id: string) {
    setEvents((previous) => [...previous, { action, id, revision }]);
    if (retire) setShown(false);
  }
  return (
    <section className="grid w-full min-w-0 gap-4" data-testid="suggestion-tooltip-demo">
      <header>
        <h2>Suggestion actions</h2>
        <p className="type-caption text-muted-foreground">Internal React preview · unreleased</p>
      </header>
      <div className="flex flex-wrap gap-2">
        {(['addition', 'deletion', 'modification'] as const).map((next) => (
          <Button
            key={next}
            variant="outline"
            aria-pressed={type === next}
            onClick={() => setType(next)}
          >
            {next}
          </Button>
        ))}
        <Button variant="outline" onClick={() => setRevision((value) => value + 1)}>
          Update suggestion
        </Button>
        <Button variant="outline" aria-pressed={!details} onClick={() => setDetails(!details)}>
          Hide optional details
        </Button>
        <Button variant="outline" aria-pressed={moved} onClick={() => setMoved(!moved)}>
          Move suggestion
        </Button>
        <Button
          variant="outline"
          aria-pressed={!callbacks}
          onClick={() => setCallbacks(!callbacks)}
        >
          Omit callbacks
        </Button>
        <Button variant="outline" aria-pressed={retire} onClick={() => setRetire(!retire)}>
          Retire on action
        </Button>
        {!shown && (
          <Button variant="outline" onClick={() => setShown(true)}>
            Remount suggestion
          </Button>
        )}
      </div>
      <div className="relative h-64 min-w-0" data-testid="suggestion-tooltip-frame">
        {shown && (
          <StrictMode>
            <SuggestionTooltip
              suggestion={{
                id: `suggestion-${revision}`,
                type,
                author: details ? 'Ada' : '',
                reason: details
                  ? 'Preserve <strong>literal text</strong> and current callbacks.'
                  : '',
                originalText: details ? 'The original wording.' : '',
              }}
              x={moved ? 24 : undefined}
              y={moved ? 12 : undefined}
              onAccept={callbacks ? (id) => record('accept', id) : undefined}
              onReject={callbacks ? (id) => record('reject', id) : undefined}
            />
          </StrictMode>
        )}
      </div>
      <Button variant="outline">After suggestion</Button>
      <output aria-label="Suggestion callbacks" className="min-w-0 break-words">
        {JSON.stringify(events)}
      </output>
    </section>
  );
}
