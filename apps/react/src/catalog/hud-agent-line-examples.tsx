// i18n-ignore (internal unreleased component preview controls)
import { StrictMode, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { HudAgentLine } from '@/features/hud/grid/hud-agent-line';

export function HudAgentLineExamples() {
  const [line, setLine] = useState('Reading workspace notes');
  const [visible, setVisible] = useState(true);

  return (
    <section className="grid min-w-0 w-full max-w-lg gap-4" data-testid="hud-agent-line-demo">
      <header>
        <h2>Agent activity ticker</h2>
        <p className="type-caption text-muted-foreground">Internal React preview · unreleased</p>
      </header>
      <Input
        aria-label="Activity line"
        value={line}
        onChange={(event) => setLine(event.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" aria-pressed={visible} onClick={() => setVisible(!visible)}>
          Show ticker
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setLine('Reconnecting to the workspace');
            setVisible(false);
          }}
        >
          Update and remove
        </Button>
      </div>
      <div className="min-w-0 bg-card p-3" data-testid="hud-agent-line-frame">
        <StrictMode>{visible && <HudAgentLine line={line} />}</StrictMode>
      </div>
      <Button variant="outline" onClick={() => setLine('Review complete')}>
        Finish review
      </Button>
    </section>
  );
}
