// i18n-ignore (internal unreleased component preview controls and rule text)
import { StrictMode, useEffect, useEffectEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { RulesInspector } from '@/components/chat/rules-inspector';

const literalRules = '<strong>Keep this literal</strong>\nUse `pnpm` & preserve drafts.';
const modes = {
  Null: null,
  Empty: '',
  Whitespace: ' \n\t ',
  Literal: literalRules,
  Long: Array.from(
    { length: 100 },
    (_, index) => `Rule ${index + 1}: Preserve the current workspace and its drafts.`,
  ).join('\n'),
};

export function RulesInspectorExamples() {
  const [rules, setRules] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [lifetime, setLifetime] = useState(0);
  const [revision, setRevision] = useState(0);
  const [retain, setRetain] = useState(false);
  const [events, setEvents] = useState<number[]>([]);
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (!shown || !event.altKey) return;
    if (event.key.toLowerCase() === 'u') {
      event.preventDefault();
      setRules('Updated rules remain literal: <em>current</em>.');
      setRevision((value) => value + 1);
    } else if (event.key.toLowerCase() === 'x') {
      event.preventDefault();
      setShown(false);
    }
  });
  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <section className="grid w-full min-w-0 gap-4" data-testid="rules-inspector-demo">
      <header>
        <h2>Rules inspector</h2>
        <p className="type-caption text-muted-foreground">Internal React preview · unreleased</p>
      </header>
      <div className="flex flex-wrap gap-2">
        {Object.entries(modes).map(([name, value]) => (
          <Button
            key={name}
            variant="outline"
            onClick={() => {
              setRules(value);
              setLifetime((previous) => previous + 1);
              setShown(true);
            }}
          >
            {name} rules
          </Button>
        ))}
        <Button variant="outline" aria-pressed={retain} onClick={() => setRetain(!retain)}>
          Keep parent mounted after close
        </Button>
      </div>
      <p className="type-caption text-muted-foreground">
        Alt+U updates rules and callback; Alt+X removes the inspector.
      </p>
      {shown && (
        <StrictMode>
          <RulesInspector
            key={lifetime}
            rules={rules}
            onClose={() => {
              setEvents((previous) => [...previous, revision]);
              if (!retain) setShown(false);
            }}
          />
        </StrictMode>
      )}
      <Button variant="outline">After rules inspector</Button>
      <output aria-label="Rules inspector callbacks">{JSON.stringify(events)}</output>
    </section>
  );
}
