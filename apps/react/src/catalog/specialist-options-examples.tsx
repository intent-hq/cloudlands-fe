// i18n-ignore (internal unreleased component preview controls and caller values)
import { useState } from 'react';
import type { Specialist } from '$lib/constants/specialists';
import { SpecialistOptions } from '@/components/chat/specialist-options';
import { Button } from '@/components/ui/button';
import * as Menu from '@/components/ui/menu';

const specialists: Specialist[] = [
  {
    id: 'builder',
    name: 'Builder',
    description: 'Implement the selected task.',
    defaultBehaviorPrompt: '',
  },
  {
    id: 'verifier',
    name: 'Verifier',
    description: 'Check behavior and report concrete findings.',
    defaultBehaviorPrompt: '',
  },
  {
    id: 'null',
    name: 'Literal null',
    description: 'A specialist with the string ID null.',
    defaultBehaviorPrompt: '',
  },
];

export function SpecialistOptionsExamples() {
  const [value, setValue] = useState<string | null>(null);
  const [visible, setVisible] = useState(true);
  const [hold, setHold] = useState(false);
  const [retire, setRetire] = useState(false);
  const [updated, setUpdated] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [events, setEvents] = useState<{ id: string | null; revision: string }[]>([]);
  const revision = updated ? 'updated' : 'original';
  const options = empty ? [] : updated ? specialists.slice(1) : specialists;
  return (
    <section className="grid min-w-0 w-full max-w-lg gap-4" data-testid="specialist-options-demo">
      <header>
        <h2>Specialist options</h2>
        <p className="type-caption text-muted-foreground">Internal React preview · unreleased</p>
      </header>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" aria-pressed={hold} onClick={() => setHold(!hold)}>
          Hold selected value
        </Button>
        <Button variant="outline" aria-pressed={retire} onClick={() => setRetire(!retire)}>
          Retire on selection
        </Button>
        <Button variant="outline" onClick={() => setValue('unknown')}>
          Unknown saved value
        </Button>
        <Button variant="outline" onClick={() => setVisible(true)}>
          Show specialist picker
        </Button>
      </div>
      <div data-testid="specialist-options-frame">
        {visible && (
          <Menu.Root>
            <Menu.Trigger asChild>
              <Button variant="outline">Choose specialist</Button>
            </Menu.Trigger>
            <Menu.Content aria-label="Specialist preview" className="w-80">
              <SpecialistOptions
                specialists={options}
                value={value}
                onChange={(id) => {
                  setEvents((previous) => [...previous, { id, revision }]);
                  if (!hold) setValue(id);
                  if (retire) setVisible(false);
                }}
              />
              <Menu.Separator />
              <Menu.Group>
                <Menu.Item closeOnSelect={false} onSelect={() => setUpdated(!updated)}>
                  Replace options and callback
                </Menu.Item>
                <Menu.Item closeOnSelect={false} onSelect={() => setEmpty(!empty)}>
                  Toggle empty options
                </Menu.Item>
              </Menu.Group>
            </Menu.Content>
          </Menu.Root>
        )}
      </div>
      <output aria-label="Selected specialist">{JSON.stringify(value)}</output>
      <output aria-label="Specialist callbacks" className="min-w-0 break-words">
        {JSON.stringify(events)}
      </output>
    </section>
  );
}
