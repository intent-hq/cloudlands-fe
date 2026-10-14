// i18n-ignore (internal unreleased component preview controls)
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SetupScriptTrigger } from '@/components/workspace/initializer/setup-script-trigger';
import { TimelineDivider } from '@/components/workspace/sidebar/timeline-divider';

export function SetupTimelineExamples() {
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [updated, setUpdated] = useState(false);
  const [children, setChildren] = useState(true);
  const [events, setEvents] = useState<string[]>([]);
  const [value, setValue] = useState('pnpm install');
  const revision = updated ? 'updated' : 'original';

  return (
    <section className="grid min-w-0 w-full max-w-lg gap-4" data-testid="setup-timeline-demo">
      <header>
        <h2>Setup and timeline controls</h2>
        <p className="type-caption text-muted-foreground">Internal React preview · unreleased</p>
      </header>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" aria-pressed={loading} onClick={() => setLoading(!loading)}>
          Detecting
        </Button>
        <Button variant="outline" aria-pressed={expanded} onClick={() => setExpanded(!expanded)}>
          Expanded
        </Button>
        <Button variant="outline" aria-pressed={updated} onClick={() => setUpdated(!updated)}>
          Replace callbacks
        </Button>
        <Button variant="outline" aria-pressed={children} onClick={() => setChildren(!children)}>
          Show timeline actions
        </Button>
      </div>
      <Input
        aria-label="Setup command preview"
        value={value}
        onChange={(event) => setValue(event.currentTarget.value)}
      />
      <div className="min-w-0" data-testid="setup-trigger-frame">
        <SetupScriptTrigger
          value={value}
          loading={loading}
          expanded={expanded}
          onOpen={() => setEvents((previous) => [...previous, `setup:${revision}`])}
        />
      </div>
      <div className="min-w-0 p-2" data-testid="timeline-divider-frame">
        <TimelineDivider>
          {children && (
            <>
              <Button
                variant="outline"
                onClick={() => setEvents((previous) => [...previous, `review:${revision}`])}
              >
                Review change
              </Button>
              <Button
                variant="outline"
                onClick={() => setEvents((previous) => [...previous, `continue:${revision}`])}
              >
                Continue
              </Button>
            </>
          )}
        </TimelineDivider>
      </div>
      <output aria-label="Setup and timeline callbacks" className="min-w-0 break-words">
        {JSON.stringify(events)}
      </output>
    </section>
  );
}
