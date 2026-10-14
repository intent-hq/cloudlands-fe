// i18n-ignore (internal unreleased component preview controls)
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { HudStateBars, type HudStateBar } from '@/features/hud/components/hud-state-bars';

export function HudStateBarsExamples() {
  const [updated, setUpdated] = useState(false);
  const [blink, setBlink] = useState(false);
  const [visible, setVisible] = useState(true);
  const [empty, setEmpty] = useState(false);
  const bars: HudStateBar[] = [
    {
      label: 'ACTIVE',
      count: updated ? 7 : 3,
      color: 'hsl(var(--primary))',
      testId: 'hud-active-row',
    },
    {
      label: 'WAITING',
      count: updated ? 1 : 2,
      color: 'hsl(var(--muted-foreground))',
      blink,
      testId: 'hud-waiting-row',
    },
  ];

  return (
    <section className="grid min-w-0 w-full max-w-lg gap-4" data-testid="hud-state-bars-demo">
      <header>
        <h2>HUD state bars</h2>
        <p className="type-caption text-muted-foreground">Internal React preview · unreleased</p>
      </header>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setUpdated(!updated)}>
          Update counts
        </Button>
        <Button variant="outline" aria-pressed={blink} onClick={() => setBlink(!blink)}>
          Blink waiting
        </Button>
        <Button variant="outline" aria-pressed={empty} onClick={() => setEmpty(!empty)}>
          Empty bars
        </Button>
        <Button variant="outline" aria-pressed={visible} onClick={() => setVisible(!visible)}>
          Show bars
        </Button>
      </div>
      <Button variant="outline">Before bars</Button>
      <div className="min-w-0 bg-card" data-testid="hud-state-bars-frame">
        {visible && (
          <HudStateBars bars={empty ? [] : updated ? bars.toReversed() : bars} total={10} />
        )}
      </div>
      <Button variant="outline">After bars</Button>
    </section>
  );
}
