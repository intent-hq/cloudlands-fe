// i18n-ignore (internal unreleased component preview controls)
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { HudPanel } from '@/features/hud/components/hud-panel';

export function HudPanelExamples() {
  const [fill, setFill] = useState(false);
  const [meta, setMeta] = useState(true);
  const [visible, setVisible] = useState(true);
  const [updated, setUpdated] = useState(false);
  const [events, setEvents] = useState<string[]>([]);
  const title = updated ? 'REVIEW' : 'ATTENTION';

  return (
    <section className="grid min-w-0 w-full max-w-lg gap-4" data-testid="hud-panel-demo">
      <header>
        <h1>HUD panel</h1>
        <p className="type-caption text-muted-foreground">Internal React preview · unreleased</p>
      </header>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" aria-pressed={fill} onClick={() => setFill(!fill)}>
          Fill panel
        </Button>
        <Button variant="outline" aria-pressed={meta} onClick={() => setMeta(!meta)}>
          Show metadata
        </Button>
        <Button variant="outline" onClick={() => setUpdated(!updated)}>
          Change title
        </Button>
        <Button variant="outline" aria-pressed={visible} onClick={() => setVisible(!visible)}>
          Show panel
        </Button>
      </div>
      <div className="flex min-h-64 min-w-0 flex-col" data-testid="hud-panel-frame">
        {visible && (
          <HudPanel
            title={title}
            fill={fill}
            meta={
              meta && (
                <Button
                  variant="ghost"
                  size="compact"
                  onClick={() => setEvents((previous) => [...previous, `meta:${title}`])}
                >
                  Inspect
                </Button>
              )
            }
          >
            <div className="grid min-w-0 gap-3 p-3">
              <Input aria-label="HUD draft" placeholder="Draft a review note" />
              <Button
                variant="outline"
                onClick={() => setEvents((previous) => [...previous, `child:${title}`])}
              >
                Review
              </Button>
            </div>
          </HudPanel>
        )}
      </div>
      <Button variant="outline" onClick={() => setEvents((previous) => [...previous, 'after'])}>
        After panel
      </Button>
      <output aria-label="HUD callbacks" className="min-w-0 break-words">
        {JSON.stringify(events)}
      </output>
    </section>
  );
}
