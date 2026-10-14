// i18n-ignore (internal unreleased component preview controls)
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LineChangeStats } from '@/components/shared/line-change-stats';
import { LineChangesBadge } from '@/components/shared/line-changes-badge';

export function LineChangeIndicatorExamples() {
  const [additions, setAdditions] = useState(1234);
  const [deletions, setDeletions] = useState(56);
  const [showZero, setShowZero] = useState(false);
  const [loading, setLoading] = useState(false);
  const [animated, setAnimated] = useState(false);
  const [icons, setIcons] = useState(false);
  const [visible, setVisible] = useState(true);

  return (
    <section className="grid min-w-0 w-full max-w-lg gap-4" data-testid="line-change-demo">
      <header>
        <h2>Line changes</h2>
        <p className="type-caption text-muted-foreground">Internal React preview · unreleased</p>
      </header>
      <div className="grid min-w-0 grid-cols-2 gap-3">
        <Input
          aria-label="Added lines"
          type="number"
          value={additions}
          onChange={(event) => setAdditions(Number(event.target.value))}
        />
        <Input
          aria-label="Deleted lines"
          type="number"
          value={deletions}
          onChange={(event) => setDeletions(Number(event.target.value))}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" aria-pressed={showZero} onClick={() => setShowZero(!showZero)}>
          Show zero
        </Button>
        <Button variant="outline" aria-pressed={loading} onClick={() => setLoading(!loading)}>
          Loading stats
        </Button>
        <Button variant="outline" aria-pressed={animated} onClick={() => setAnimated(!animated)}>
          Animate badge
        </Button>
        <Button variant="outline" aria-pressed={icons} onClick={() => setIcons(!icons)}>
          Show icons
        </Button>
        <Button variant="outline" aria-pressed={visible} onClick={() => setVisible(!visible)}>
          Show indicators
        </Button>
      </div>
      <Button
        variant="outline"
        onClick={() => {
          setAdditions(0);
          setDeletions(0);
        }}
      >
        Clear changes
      </Button>
      <div className="grid min-w-0 gap-3 bg-card p-3" data-testid="line-change-frame">
        <div data-testid="line-stats">
          {visible && (
            <LineChangeStats
              additions={additions}
              deletions={deletions}
              showZero={showZero}
              loading={loading}
            />
          )}
        </div>
        <div data-testid="line-badge">
          {visible && (
            <LineChangesBadge
              additions={additions}
              deletions={deletions}
              showZero={showZero}
              showIcons={icons}
              animated={animated}
            />
          )}
        </div>
      </div>
      <Button
        variant="outline"
        onClick={() => {
          setAdditions(1234);
          setDeletions(56);
        }}
      >
        Restore changes
      </Button>
    </section>
  );
}
