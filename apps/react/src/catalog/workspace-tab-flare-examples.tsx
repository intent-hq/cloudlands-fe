// i18n-ignore (internal migration preview controls)
import { StrictMode, useState } from 'react';
import { Button } from '@/components/ui/button';
import { WorkspaceTabFlare } from '@/components/layout/workspace-tab-flare';
import { WORKSPACE_TAB_MOTION_DURATION_MS } from '$lib/components/layout/titlebar-geometry';

export function WorkspaceTabFlareExamples() {
  const [side, setSide] = useState<'leading' | 'trailing'>('leading');
  const [visible, setVisible] = useState(true);
  const [mounted, setMounted] = useState(true);
  const [slow, setSlow] = useState(false);
  const [events, setEvents] = useState<string[]>([]);

  return (
    <section className="grid min-w-0 gap-4" data-testid="workspace-flare-demo">
      <header>
        <h2>Workspace tab decoration</h2>
        <p className="type-caption text-muted-foreground">Internal layout preview</p>
      </header>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => setSide(side === 'leading' ? 'trailing' : 'leading')}
        >
          Switch edge
        </Button>
        <Button variant="outline" aria-pressed={visible} onClick={() => setVisible(!visible)}>
          Show decoration
        </Button>
        <Button variant="outline" aria-pressed={slow} onClick={() => setSlow(!slow)}>
          Slower transition
        </Button>
        <Button variant="outline" aria-pressed={mounted} onClick={() => setMounted(!mounted)}>
          Mount decoration
        </Button>
      </div>
      <Button variant="outline">Before workspace action</Button>
      <div
        className="flex min-h-24 items-center justify-center bg-sidebar p-4"
        data-testid="workspace-flare-frame"
      >
        <Button
          variant="outline"
          onClick={() => setEvents((previous) => [...previous, side])}
          aria-label="Open preview workspace"
        >
          <span className="relative mx-4" data-testid="workspace-flare-anchor">
            Example workspace
            {mounted && (
              <StrictMode>
                <WorkspaceTabFlare
                  side={side}
                  visible={visible}
                  durationMs={WORKSPACE_TAB_MOTION_DURATION_MS * (slow ? 2 : 1)}
                />
              </StrictMode>
            )}
          </span>
        </Button>
      </div>
      <Button variant="outline">After workspace action</Button>
      <output aria-label="Workspace callbacks">{JSON.stringify(events)}</output>
    </section>
  );
}
