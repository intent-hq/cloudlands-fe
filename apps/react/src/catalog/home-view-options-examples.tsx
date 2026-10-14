// i18n-ignore (internal unreleased component preview controls)
import { useState } from 'react';
import { HomeViewOptions } from '@/features/home/components/home-view-options';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function HomeViewOptionsExamples() {
  const [visible, setVisible] = useState(true);
  const [updated, setUpdated] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [draft, setDraft] = useState('');
  const [events, setEvents] = useState<string[]>([]);
  const revision = updated ? 'updated' : 'original';
  return (
    <section className="grid min-w-0 w-full max-w-lg gap-4" data-testid="home-view-options-demo">
      <header>
        <h2>Home view options</h2>
        <p className="type-caption text-muted-foreground">Internal React preview · unreleased</p>
      </header>
      <Button variant="outline">Outside target</Button>
      <div className="flex justify-end" data-testid="home-view-options-frame">
        {visible && (
          <HomeViewOptions>
            <Input
              aria-label="View draft"
              value={draft}
              onChange={(event) => setDraft(event.currentTarget.value)}
            />
            <Button variant="outline" aria-pressed={updated} onClick={() => setUpdated(!updated)}>
              Replace child callback
            </Button>
            <Button
              variant="outline"
              aria-pressed={disabled}
              onClick={() => setDisabled(!disabled)}
            >
              Disable child action
            </Button>
            <Button
              disabled={disabled}
              onClick={() => setEvents((previous) => [...previous, `${revision}:${draft}`])}
            >
              Apply preview
            </Button>
            <Button variant="ghost" onClick={() => setVisible(false)}>
              Remove view options
            </Button>
          </HomeViewOptions>
        )}
      </div>
      <Button variant="outline" onClick={() => setVisible(true)}>
        Show view options
      </Button>
      <output aria-label="View-option callbacks" className="min-w-0 break-words">
        {JSON.stringify(events)}
      </output>
    </section>
  );
}
