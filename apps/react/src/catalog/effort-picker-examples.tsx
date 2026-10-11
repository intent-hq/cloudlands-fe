// Supplemental embedded callback consumer; no session, catalog service or daemon is substituted.
// i18n-ignore (internal catalog exercise controls and explicit prop values, not product copy)
import { useEffect, useRef, useState } from 'react';
import { EffortPicker } from '@/components/chat/input/effort-picker';
import { ContentDialog } from '@/components/patterns/confirm';
import { FormField } from '@/components/patterns/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

const catalogs = {
  standard: ['low', 'medium', 'high'],
  extended: ['low', 'medium', 'high', 'xhigh'],
  empty: [],
};

type CallbackRecord = {
  id: number;
  effort: string | null;
  result: 'pending' | boolean;
};

export function EffortPickerExamples() {
  const [catalog, setCatalog] = useState<keyof typeof catalogs>('standard');
  const [persisted, setPersisted] = useState<string | null>(null);
  const [external, setExternal] = useState('legacy-ultra');
  const [busy, setBusy] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [mounted, setMounted] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [hold, setHold] = useState(false);
  const [callbacks, setCallbacks] = useState<CallbackRecord[]>([]);
  const nextId = useRef(0);
  const pending = useRef(new Set<(accepted: boolean) => void>());
  const pendingCount = callbacks.filter(({ result }) => result === 'pending').length;

  useEffect(() => {
    const callbacksToRelease = pending.current;
    return () => {
      // Navigating away releases local callers with false, never a swallowed rejection.
      for (const resolve of callbacksToRelease) resolve(false);
      callbacksToRelease.clear();
    };
  }, []);

  async function changeEffort(effort: string | null) {
    const id = ++nextId.current;
    setCallbacks((current) => [...current, { id, effort, result: 'pending' }]);
    const accepted = hold
      ? await new Promise<boolean>((resolve) => pending.current.add(resolve))
      : true;
    // This is the actual embedded caller boundary: true updates its prop; false leaves it alone.
    if (accepted) setPersisted(effort);
    setCallbacks((current) =>
      current.map((callback) =>
        callback.id === id ? { ...callback, result: accepted } : callback,
      ),
    );
    return accepted;
  }

  function resolveNext(accepted: boolean) {
    const resolve = pending.current.values().next().value;
    if (!resolve) return;
    pending.current.delete(resolve);
    resolve(accepted);
  }

  const exercise = (
    <div className="grid gap-4" data-testid="effort-exercise-host">
      <FormField
        label="Effort catalog"
        control={(field) => (
          <ToggleGroup
            id={field.id}
            type="single"
            aria-label="Effort catalog"
            value={catalog}
            onValueChange={(value) => {
              if (value === 'standard' || value === 'extended' || value === 'empty')
                setCatalog(value);
            }}
          >
            <ToggleGroupItem value="standard">Standard levels</ToggleGroupItem>
            <ToggleGroupItem value="extended">Extended levels</ToggleGroupItem>
            <ToggleGroupItem value="empty">No levels</ToggleGroupItem>
          </ToggleGroup>
        )}
      />
      <FormField
        label="External persisted effort"
        control={(field) => (
          <Input
            {...field}
            value={external}
            onChange={(event) => setExternal(event.currentTarget.value)}
          />
        )}
      />
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setPersisted(external)}>Apply external effort</Button>
        <Button onClick={() => setPersisted(null)}>Apply external Auto</Button>
      </div>
      <div className="flex flex-wrap gap-4">
        <FormField
          label="Busy effort picker"
          control={(field) => <Switch {...field} checked={busy} onCheckedChange={setBusy} />}
        />
        <FormField
          label="Disable effort picker"
          control={(field) => (
            <Switch {...field} checked={disabled} onCheckedChange={setDisabled} />
          )}
        />
        <FormField
          label="Hold effort callback"
          control={(field) => <Switch {...field} checked={hold} onCheckedChange={setHold} />}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button disabled={!pendingCount} onClick={() => resolveNext(false)}>
          Resolve next effort callback false
        </Button>
        <Button disabled={!pendingCount} onClick={() => resolveNext(true)}>
          Resolve next effort callback true
        </Button>
        <Button onClick={() => setMounted((current) => !current)}>
          {mounted ? 'Unmount effort picker' : 'Mount effort picker'}
        </Button>
      </div>
      {mounted && (
        <EffortPicker
          mode="embedded"
          effortLevels={catalogs[catalog]}
          effort={persisted}
          busy={busy || pendingCount > 0}
          disabled={disabled}
          modalAware={dialogOpen}
          onEffortChange={changeEffort}
        />
      )}
      <dl className="grid gap-2">
        <div>
          <dt>Persisted prop (the trigger shows the current selection)</dt>
          <dd>
            <output aria-label="Effort persisted value">{JSON.stringify(persisted)}</output>
          </dd>
        </div>
        <div>
          <dt>Catalog levels</dt>
          <dd>
            <output aria-label="Effort catalog levels">{JSON.stringify(catalogs[catalog])}</output>
          </dd>
        </div>
        <div>
          <dt>Callback history (exact effort payload and result)</dt>
          <dd>
            <output aria-label="Effort callbacks">{JSON.stringify(callbacks)}</output>
          </dd>
        </div>
        <div>
          <dt>Pending callbacks</dt>
          <dd>
            <output aria-label="Effort pending count">{pendingCount}</output>
          </dd>
        </div>
        <div>
          <dt>Picker mounted</dt>
          <dd>
            <output aria-label="Effort picker mounted">{String(mounted)}</output>
          </dd>
        </div>
        <div>
          <dt>Parent dialog open</dt>
          <dd>
            <output aria-label="Effort parent dialog open">{String(dialogOpen)}</output>
          </dd>
        </div>
      </dl>
    </div>
  );

  return (
    <section className="grid gap-4" data-functional-example="effort-picker-callback">
      <h2>Embedded effort callback</h2>
      <p className="type-caption text-muted-foreground">
        Internal callback exercise with explicit local props. No daemon persistence, agent session
        or full ModelPicker behavior is exercised. These are supplemental inputs, not a source
        appearance fixture or a browser acceptance result.
      </p>
      <p className="type-caption text-muted-foreground">
        Auto sends null. Held callbacks settle oldest first: true writes the requested value to the
        parent prop; false keeps the current parent value. Pending callbacks announce busy without
        disabling selection. Unmounting the picker keeps those callbacks available to settle.
      </p>
      <Button disabled={dialogOpen} onClick={() => setDialogOpen(true)}>
        Open effort parent dialog
      </Button>
      {dialogOpen ? (
        <ContentDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          title="Effort parent dialog"
          footer={<Button onClick={() => setDialogOpen(false)}>Close effort parent dialog</Button>}
        >
          {exercise}
        </ContentDialog>
      ) : (
        exercise
      )}
    </section>
  );
}
