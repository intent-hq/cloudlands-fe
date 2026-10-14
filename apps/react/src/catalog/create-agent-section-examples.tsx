// i18n-ignore (internal callback-only preview controls)
import { StrictMode, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CreateAgentSection } from '@/components/workspace/create-agent-section';

export function CreateAgentSectionExamples() {
  const [compact, setCompact] = useState(false);
  const [primary, setPrimary] = useState(true);
  const [fallback, setFallback] = useState(true);
  const [revision, setRevision] = useState(1);
  const [retire, setRetire] = useState(false);
  const [shown, setShown] = useState(true);
  const [events, setEvents] = useState<
    { kind: string; revision: number; specialist?: string | null }[]
  >([]);
  const finish = () => {
    if (retire) setShown(false);
  };

  return (
    <section className="grid w-full min-w-0 gap-4" data-testid="create-agent-demo">
      <header>
        <h2>Agent creation control</h2>
        <p className="type-caption text-muted-foreground">
          Internal callback preview · creates no agents
        </p>
      </header>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" aria-pressed={compact} onClick={() => setCompact(!compact)}>
          Compact control
        </Button>
        <Button variant="outline" aria-pressed={primary} onClick={() => setPrimary(!primary)}>
          Primary callback
        </Button>
        <Button variant="outline" aria-pressed={fallback} onClick={() => setFallback(!fallback)}>
          Specialist callback
        </Button>
        <Button variant="outline" onClick={() => setRevision((value) => value + 1)}>
          Replace callbacks
        </Button>
        <Button variant="outline" aria-pressed={retire} onClick={() => setRetire(!retire)}>
          Retire on activation
        </Button>
        {!shown && (
          <Button variant="outline" onClick={() => setShown(true)}>
            Remount control
          </Button>
        )}
      </div>
      <Button variant="outline">Before creation control</Button>
      <div className="min-h-12 min-w-0" data-testid="create-agent-frame">
        {shown && (
          <StrictMode>
            <CreateAgentSection
              compact={compact}
              onCreate={
                primary
                  ? () => {
                      setEvents((previous) => [...previous, { kind: 'primary', revision }]);
                      finish();
                    }
                  : undefined
              }
              onCreateWithSpecialist={
                fallback
                  ? (specialist) => {
                      setEvents((previous) => [
                        ...previous,
                        { kind: 'specialist', revision, specialist },
                      ]);
                      finish();
                    }
                  : undefined
              }
            />
          </StrictMode>
        )}
      </div>
      <Button variant="outline">After creation control</Button>
      <output aria-label="Creation callbacks" className="min-w-0 break-words">
        {JSON.stringify(events)}
      </output>
    </section>
  );
}
