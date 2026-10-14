// i18n-ignore (internal unreleased component preview controls and sample content)
import { StrictMode, useEffect, useEffectEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { DividerButton } from '@/components/workspace/sidebar/divider-button';

export function DividerButtonExamples() {
  const [revision, setRevision] = useState(1);
  const [loading, setLoading] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [tooltip, setTooltip] = useState(false);
  const [submit, setSubmit] = useState(false);
  const [shown, setShown] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [events, setEvents] = useState<number[]>([]);
  const [submissions, setSubmissions] = useState(0);
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.altKey && event.key.toLowerCase() === 'u') {
      event.preventDefault();
      setRevision((value) => value + 1);
    }
  });
  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <section className="grid w-full min-w-0 gap-4" data-testid="divider-button-demo">
      <header>
        <h2>Sidebar divider button</h2>
        <p className="type-caption text-muted-foreground">Internal React preview · unreleased</p>
      </header>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" aria-pressed={loading} onClick={() => setLoading(!loading)}>
          Loading content
        </Button>
        <Button variant="outline" aria-pressed={disabled} onClick={() => setDisabled(!disabled)}>
          Disable divider
        </Button>
        <Button variant="outline" aria-pressed={tooltip} onClick={() => setTooltip(!tooltip)}>
          Show divider tooltip
        </Button>
        <Button variant="outline" aria-pressed={submit} onClick={() => setSubmit(!submit)}>
          Use submit type
        </Button>
        <Button variant="outline" aria-pressed={shown} onClick={() => setShown(!shown)}>
          Mount divider
        </Button>
      </div>
      <p className="type-caption text-muted-foreground">Alt+U updates the content and callback.</p>
      <Button variant="outline">Before divider</Button>
      <form
        className="grid min-h-24 min-w-0 place-items-center py-4"
        data-testid="divider-button-frame"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmissions((value) => value + 1);
        }}
      >
        {shown && (
          <StrictMode>
            <DividerButton
              aria-label="Toggle saved section"
              aria-expanded={expanded}
              loading={loading}
              disabled={disabled}
              expanded={expanded}
              tooltipContents={tooltip ? `Saved section help ${revision}` : ''}
              {...(submit ? { type: 'submit' as const } : {})}
              onClick={() => {
                setEvents((previous) => [...previous, revision]);
                setExpanded((value) => !value);
              }}
            >
              {revision === 1 ? 'Show saved section' : 'Updated saved section'}
            </DividerButton>
          </StrictMode>
        )}
      </form>
      <Button variant="outline">After divider</Button>
      <output aria-label="Divider events">{JSON.stringify({ events, submissions })}</output>
    </section>
  );
}
