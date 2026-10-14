// i18n-ignore (internal unreleased preview controls and brand names)
import { StrictMode, useState } from 'react';
import { SidebarIcon } from '@/components/icons/sidebar-icon';
import { ServerIcon } from '@/components/icons/server-icon';
import { GitRepoIcon } from '@/components/icons/git-repo-icon';
import { GitBranchIcon } from '@/components/icons/git-branch-icon';
import { ElevenLabsIcon } from '@/components/icons/eleven-labs-icon';
import { OpenAIIcon } from '@/components/icons/openai-icon';
import { Button } from '@/components/ui/button';

const icons = [
  ['Sidebar', SidebarIcon],
  ['Server', ServerIcon],
  ['Repository', GitRepoIcon],
  ['Branch', GitBranchIcon],
  ['ElevenLabs', ElevenLabsIcon],
  ['OpenAI', OpenAIIcon],
] as const;
const sizes = [undefined, 24, 0, 47.5];

export function CompactIconExamples() {
  const [sizeIndex, setSizeIndex] = useState(0);
  const [side, setSide] = useState<'left' | 'right'>('left');
  const [visible, setVisible] = useState(true);
  const [disabled, setDisabled] = useState(false);
  const [events, setEvents] = useState<string[]>([]);
  const size = sizes[sizeIndex];

  return (
    <section className="grid w-full min-w-0 max-w-lg gap-4" data-testid="compact-icons-demo">
      <header>
        <h2>Compact icons</h2>
        <p className="type-caption text-muted-foreground">Internal React preview · unreleased</p>
      </header>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => setSizeIndex((index) => (index + 1) % sizes.length)}
        >
          Next size
        </Button>
        <Button variant="outline" onClick={() => setSide(side === 'left' ? 'right' : 'left')}>
          Swap sidebar side
        </Button>
        <Button variant="outline" aria-pressed={disabled} onClick={() => setDisabled(!disabled)}>
          Disable actions
        </Button>
        <Button variant="outline" aria-pressed={visible} onClick={() => setVisible(!visible)}>
          Mount actions
        </Button>
      </div>
      <Button variant="outline" onClick={() => setEvents((previous) => [...previous, 'before'])}>
        Before icons
      </Button>
      <div
        className="flex min-h-24 flex-wrap items-center gap-3 bg-muted p-4"
        data-testid="compact-icons-frame"
      >
        <StrictMode>
          {visible &&
            icons.map(([name, Icon]) => (
              <Button
                key={name}
                variant="outline"
                disabled={disabled}
                onClick={() =>
                  setEvents((previous) => [...previous, `${name}:${side}:${size ?? 'default'}`])
                }
                leadingIcon={
                  <span aria-hidden="true">
                    <Icon size={size} side={side} />
                  </span>
                }
              >
                {name}
              </Button>
            ))}
        </StrictMode>
      </div>
      <Button variant="outline" onClick={() => setEvents((previous) => [...previous, 'after'])}>
        After icons
      </Button>
      <output aria-label="Compact icon callbacks" className="min-w-0 break-words">
        {JSON.stringify(events)}
      </output>
    </section>
  );
}
