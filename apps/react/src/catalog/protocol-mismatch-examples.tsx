// i18n-ignore (internal unreleased component preview controls and event values)
import { StrictMode, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ProtocolMismatchModal } from '@/components/layout/protocol-mismatch-modal';

export function ProtocolMismatchExamples() {
  const [shown, setShown] = useState(false);
  const [lifetime, setLifetime] = useState(0);
  const [updated, setUpdated] = useState(false);
  const [retire, setRetire] = useState(false);
  const [staticPosition, setStaticPosition] = useState(false);
  const [callbacks, setCallbacks] = useState(true);
  const [events, setEvents] = useState<string[]>([]);
  const revision = updated ? 'updated' : 'original';
  return (
    <section className="grid min-w-0 w-full gap-4" data-testid="protocol-advisory-demo">
      <header>
        <h2>Protocol advisory</h2>
        <p className="type-caption text-muted-foreground">Internal React preview · unreleased</p>
      </header>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => {
            setLifetime((value) => value + 1);
            setShown(true);
          }}
        >
          Open advisory
        </Button>
        <Button variant="outline" aria-pressed={retire} onClick={() => setRetire(!retire)}>
          Retire on local action
        </Button>
        <Button
          variant="outline"
          aria-pressed={staticPosition}
          onClick={() => setStaticPosition(!staticPosition)}
        >
          Static advisory
        </Button>
        <Button
          variant="outline"
          aria-pressed={!callbacks}
          onClick={() => setCallbacks(!callbacks)}
        >
          Omit callbacks
        </Button>
      </div>
      <div data-testid="protocol-advisory-frame">
        {shown && (
          <StrictMode>
            <ProtocolMismatchModal
              key={lifetime}
              static={staticPosition}
              event={{
                id: 'preview-remote',
                host: updated
                  ? 'updated-preview-remote.example.test'
                  : 'long-preview-remote-hostname.example.test',
                port: 443,
                localProtocolVersion: '2026.10.0',
                remoteProtocolVersion: updated ? '2028.2.0' : '2027.1.0',
              }}
              onOpenLocal={
                callbacks
                  ? () => {
                      setEvents((previous) => [...previous, `local:${revision}`]);
                      setUpdated(true);
                      if (retire) setShown(false);
                    }
                  : undefined
              }
              onContinue={
                callbacks
                  ? () => setEvents((previous) => [...previous, `continue:${revision}`])
                  : undefined
              }
            />
          </StrictMode>
        )}
      </div>
      <Button variant="outline">After advisory</Button>
      <output aria-label="Protocol advisory callbacks" className="min-w-0 break-words">
        {JSON.stringify(events)}
      </output>
    </section>
  );
}
