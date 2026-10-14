// i18n-ignore (internal unreleased component preview controls and summary content)
import { StrictMode, useEffect, useEffectEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { SidebarLauncherHoverCard } from '@/components/workspace/sidebar/sidebar-launcher-hover-card';

export function LauncherHoverCardExamples() {
  const [revision, setRevision] = useState(1);
  const [blank, setBlank] = useState(false);
  const [open, setOpen] = useState(false);
  const [retire, setRetire] = useState(false);
  const [shown, setShown] = useState(true);
  const [events, setEvents] = useState<{ open: boolean; revision: number }[]>([]);
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
    <section className="grid w-full min-w-0 gap-4" data-testid="launcher-hover-demo">
      <header>
        <h2>Launcher summary</h2>
        <p className="type-caption text-muted-foreground">Internal React preview · unreleased</p>
      </header>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" aria-pressed={blank} onClick={() => setBlank(!blank)}>
          Only blank rows
        </Button>
        <Button variant="outline" onClick={() => setOpen(true)}>
          Open from parent
        </Button>
        <Button variant="outline" onClick={() => setOpen(false)}>
          Close from parent
        </Button>
        <Button variant="outline" aria-pressed={retire} onClick={() => setRetire(!retire)}>
          Retire after dismiss
        </Button>
        {!shown && (
          <Button variant="outline" onClick={() => setShown(true)}>
            Remount launcher
          </Button>
        )}
      </div>
      <p className="type-caption text-muted-foreground">
        Alt+U updates the visible summary and callback.
      </p>
      <Button variant="outline">Before launcher</Button>
      <div className="grid min-w-0 py-4" data-testid="launcher-hover-frame">
        {shown && (
          <StrictMode>
            <SidebarLauncherHoverCard
              title={revision === 1 ? 'Review current work' : 'Updated task summary'}
              rows={
                blank
                  ? [{ label: 'Blank row', text: '  \n ' }]
                  : [
                      { label: 'Blank row', text: '  \n ' },
                      {
                        label: 'Summary',
                        text:
                          revision === 1
                            ? 'Inspect the saved changes.\nKeep drafts and focus intact.'
                            : 'Updated content from the current caller.',
                      },
                    ]
              }
              emptyText="No summary is available."
              kind={revision === 1 ? 'agent' : 'note'}
              status={revision === 1 ? 'Working' : 'Waiting'}
              statusTone={revision === 1 ? 'success' : 'warning'}
              open={open}
              onOpenChange={(next) => {
                setEvents((previous) => [...previous, { open: next, revision }]);
                if (!next && retire) setShown(false);
              }}
            >
              <Button variant="outline">Launcher preview</Button>
            </SidebarLauncherHoverCard>
          </StrictMode>
        )}
      </div>
      <Button variant="outline">After launcher</Button>
      <output aria-label="Launcher visibility callbacks">{JSON.stringify(events)}</output>
    </section>
  );
}
