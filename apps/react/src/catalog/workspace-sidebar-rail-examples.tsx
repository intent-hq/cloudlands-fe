// i18n-ignore (internal unreleased component preview controls)
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { WorkspaceSidebarRail } from '@/components/workspace/sidebar/workspace-sidebar-rail';

export function WorkspaceSidebarRailExamples() {
  const [updated, setUpdated] = useState(false);
  const [visible, setVisible] = useState(true);
  const [events, setEvents] = useState<string[]>([]);

  return (
    <section className="grid min-w-0 w-full max-w-lg gap-4" data-testid="workspace-rail-demo">
      <header>
        <h2>Workspace sidebar rail</h2>
        <p className="type-caption text-muted-foreground">Internal React preview · unreleased</p>
      </header>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" aria-pressed={updated} onClick={() => setUpdated(!updated)}>
          Replace expand callback
        </Button>
        <Button variant="outline" aria-pressed={visible} onClick={() => setVisible(!visible)}>
          Show rail
        </Button>
      </div>
      <Button variant="outline" onClick={() => setEvents((previous) => [...previous, 'before'])}>
        Before rail
      </Button>
      <div className="h-48 w-12 bg-card" data-testid="workspace-rail-frame">
        {visible && (
          <WorkspaceSidebarRail
            onExpand={() =>
              setEvents((previous) => [...previous, updated ? 'updated' : 'original'])
            }
          />
        )}
      </div>
      <Button variant="outline" onClick={() => setEvents((previous) => [...previous, 'after'])}>
        After rail
      </Button>
      <output aria-label="Rail callbacks" className="min-w-0 break-words">
        {JSON.stringify(events)}
      </output>
    </section>
  );
}
