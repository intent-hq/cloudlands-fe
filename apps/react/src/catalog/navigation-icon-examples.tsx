// i18n-ignore (internal unreleased component preview controls)
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  IntentNavigationIcon,
  intentNavigationIconNames,
  type IntentNavigationIconName,
} from '@/components/icons/intent-navigation-icon';

export function NavigationIconExamples() {
  const [active, setActive] = useState<IntentNavigationIconName>('spaces');
  const [size, setSize] = useState('16');
  const [disabled, setDisabled] = useState(false);
  const [visible, setVisible] = useState(true);
  const [events, setEvents] = useState<string[]>([]);

  return (
    <section className="grid min-w-0 w-full max-w-lg gap-4" data-testid="navigation-icon-demo">
      <header>
        <h2>Navigation icons</h2>
        <p className="type-caption text-muted-foreground">Internal React preview · unreleased</p>
      </header>
      <Input
        aria-label="Icon size"
        value={size}
        onChange={(event) => setSize(event.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" aria-pressed={disabled} onClick={() => setDisabled(!disabled)}>
          Disable action
        </Button>
        <Button variant="outline" aria-pressed={visible} onClick={() => setVisible(!visible)}>
          Show action
        </Button>
      </div>
      <div className="flex flex-wrap gap-2" data-testid="navigation-icon-choices">
        {intentNavigationIconNames.map((name) => (
          <Button
            key={name}
            variant="outline"
            aria-pressed={active === name}
            onClick={() => setActive(name)}
          >
            <IntentNavigationIcon name={name} />
            {name}
          </Button>
        ))}
      </div>
      <Button variant="outline" onClick={() => setEvents((previous) => [...previous, 'before'])}>
        Before action
      </Button>
      <div className="min-w-0" data-testid="navigation-icon-action">
        {visible && (
          <Button
            variant="outline"
            disabled={disabled}
            onClick={() => setEvents((previous) => [...previous, active])}
          >
            <IntentNavigationIcon name={active} size={size} />
            Activate icon
          </Button>
        )}
      </div>
      <Button variant="outline" onClick={() => setEvents((previous) => [...previous, 'after'])}>
        After action
      </Button>
      <output aria-label="Navigation callbacks" className="min-w-0 break-words">
        {JSON.stringify(events)}
      </output>
    </section>
  );
}
