// i18n-ignore (internal unreleased component preview controls and caller values)
import { useState } from 'react';
import { HomeFilterSelect } from '@/features/home/components/home-filter-select';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const options = [
  { value: 'any', label: 'Any' },
  { value: 'running', label: 'Running' },
  { value: 'blocked', label: 'Blocked' },
];

export function HomeFilterSelectExamples() {
  const [value, setValue] = useState('any');
  const [hold, setHold] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [updated, setUpdated] = useState(false);
  const [visible, setVisible] = useState(true);
  const [retire, setRetire] = useState(false);
  const [events, setEvents] = useState<{ value: string; revision: string }[]>([]);
  const revision = updated ? 'updated' : 'original';
  return (
    <section className="grid min-w-0 w-full max-w-lg gap-4" data-testid="home-filter-demo">
      <header>
        <h2>Home status filter</h2>
        <p className="type-caption text-muted-foreground">Internal React preview · unreleased</p>
      </header>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" aria-pressed={hold} onClick={() => setHold(!hold)}>
          Hold selection
        </Button>
        <Button variant="outline" aria-pressed={disabled} onClick={() => setDisabled(!disabled)}>
          Disable filter
        </Button>
        <Button variant="outline" onClick={() => setValue('blocked')}>
          Publish blocked
        </Button>
        <Button variant="outline" onClick={() => setUpdated(!updated)}>
          Replace options and callback
        </Button>
        <Button variant="outline" aria-pressed={retire} onClick={() => setRetire(!retire)}>
          Retire on selection
        </Button>
        <Button variant="outline" onClick={() => setVisible(true)}>
          Show filter
        </Button>
      </div>
      <div data-testid="home-filter-frame" className="w-56 max-w-full">
        {visible && (
          <HomeFilterSelect
            value={value}
            label="Workspace status"
            options={
              updated
                ? options.map((option) => ({ ...option, label: `Updated ${option.label}` }))
                : options
            }
            disabled={disabled}
            onchange={(next) => {
              setEvents((previous) => [...previous, { value: next, revision }]);
              if (!hold) setValue(next);
              if (retire) setVisible(false);
            }}
          />
        )}
      </div>
      <output aria-label="Home filter callbacks" className="min-w-0 break-words">
        {JSON.stringify(events)}
      </output>
      <SelectKeyboardExample />
    </section>
  );
}

function SelectKeyboardExample() {
  const [value, setValue] = useState('any');
  const [blocked, setBlocked] = useState(false);
  return (
    <section className="grid gap-2" aria-label="Select keyboard example">
      <Button variant="outline" aria-pressed={blocked} onClick={() => setBlocked(!blocked)}>
        Prevent typeahead
      </Button>
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger aria-label="Keyboard options">
          <SelectValue />
        </SelectTrigger>
        <SelectContent
          portal
          onKeyDown={(event) => {
            if (blocked) event.preventDefault();
          }}
        >
          <SelectGroup>
            <SelectItem value="any">Any</SelectItem>
            <SelectItem value="blocked" disabled>
              Read blocked
            </SelectItem>
            <SelectItem value="first">Read first</SelectItem>
            <SelectItem value="later">Read later</SelectItem>
            <SelectItem value="final" textValue="Zulu">
              Final
            </SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </section>
  );
}
