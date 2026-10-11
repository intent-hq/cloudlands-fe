// Local examples exercise production patterns independently of reference appearance fixtures.
// i18n-ignore (deterministic internal catalog example content)
import { ConfirmationExample } from './confirmation-example';
import { useState } from 'react';
import { TakeoverScreen } from '@/components/patterns/screen';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  AutoSaveField,
  Form,
  FormActions,
  FormField,
  FormRow,
  useForm,
} from '@/components/patterns/form';
import { ListRow, ListView, type ListKey } from '@/components/patterns/collection';

function FormExample() {
  const form = useForm({
    initial: { name: '', notes: '' },
    validate: (values) =>
      values.name.trim().length < 3 ? { name: 'Use at least three characters.' } : {},
  });
  const [saved, setSaved] = useState<typeof form.values | null>(null);
  const [submissions, setSubmissions] = useState(0);
  const [busy, setBusy] = useState(false);
  return (
    <section
      className="grid gap-4"
      data-functional-example="form-submit"
      aria-label="Form submission example"
    >
      <h2>Form submission</h2>
      <Switch aria-label="Pause form editing" checked={busy} onCheckedChange={setBusy} />
      <Form
        busy={busy}
        onSubmit={async () => {
          await form.submit((values) => {
            setSaved({ ...values });
            setSubmissions((count) => count + 1);
          });
        }}
      >
        <FormRow>
          <FormField
            label="Project name"
            name="name"
            required
            error={form.errors.name}
            control={(field) => (
              <Input
                {...field}
                value={form.values.name}
                onChange={(event) => form.setField('name', event.target.value)}
              />
            )}
          />
          <FormField
            label="Project notes"
            name="notes"
            control={(field) => (
              <Textarea
                {...field}
                value={form.values.notes}
                onChange={(event) => form.setField('notes', event.target.value)}
              />
            )}
          />
        </FormRow>
        <FormActions
          secondary={
            <Button variant="outline" onClick={() => form.reset()}>
              Reset form
            </Button>
          }
          primary={
            <Button type="submit" variant="primary">
              Save project
            </Button>
          }
        />
      </Form>
      <output aria-label="Form dirty">{String(form.dirty)}</output>
      <output aria-label="Form validation errors">{JSON.stringify(form.errors)}</output>
      <output aria-label="Form submission count">{submissions}</output>
      <output aria-label="Saved project">{JSON.stringify(saved)}</output>
    </section>
  );
}

function AutosaveExample() {
  const [saved, setSaved] = useState('Workspace');
  const [saves, setSaves] = useState(0);
  const [disabled, setDisabled] = useState(false);
  return (
    <section
      className="grid gap-4"
      data-functional-example="autosave"
      aria-label="Autosave example"
    >
      <h2>Autosave</h2>
      <Switch
        aria-label="Pause autosave editing"
        checked={disabled}
        onCheckedChange={setDisabled}
      />
      <AutoSaveField
        value={saved}
        originalValue={saved}
        disabled={disabled}
        canSave={(value) => value.trim().length > 0}
        prepare={(value) => value.trim()}
        onSave={(value) => {
          setSaved(value);
          setSaves((count) => count + 1);
        }}
      >
        {({ value, update, onFocus, onBlur, onKeyDown, disabled: fieldDisabled, status }) => (
          <>
            <Input
              aria-label="Autosave workspace name"
              value={value}
              onChange={(event) => update(event.target.value)}
              onFocus={onFocus}
              onBlur={onBlur}
              onKeyDown={onKeyDown}
              disabled={fieldDisabled}
            />
            <output aria-label="Autosave status">{status}</output>
          </>
        )}
      </AutoSaveField>
      <Button variant="outline">Leave autosave field</Button>
      <output aria-label="Autosave count">{saves}</output>
      <output aria-label="Saved workspace name">{saved}</output>
    </section>
  );
}

const exampleItems = [
  { id: 'alpha', name: 'Alpha', description: 'First item' },
  { id: 'beta', name: 'Beta', description: 'Second item' },
  { id: 'bravo', name: 'Bravo', description: 'Third item' },
];

function CollectionExample() {
  const [selectedKeys, setSelectedKeys] = useState<ListKey[]>(['beta', 'bravo']);
  const [activated, setActivated] = useState('none');
  const [actions, setActions] = useState(0);
  return (
    <section
      className="grid gap-4"
      data-functional-example="collection-selection"
      aria-label="Collection selection example"
    >
      <h2>Collection selection</h2>
      <ListView
        items={exampleItems}
        getKey={(item) => item.id}
        getText={(item) => item.name}
        selectable="multi"
        selectedKeys={selectedKeys}
        onSelectedKeysChange={setSelectedKeys}
        onActivate={(item) => setActivated(item.id)}
        ariaLabel="Interactive collection"
        row={({ item }) => (
          <ListRow
            title={item.name}
            description={item.description}
            trailing={
              <>
                <Input aria-label={`Edit ${item.name}`} />
                <Button size="sm" onClick={() => setActions((count) => count + 1)}>
                  Act on {item.name}
                </Button>
              </>
            }
          />
        )}
      />
      <output aria-label="Selected collection keys">{JSON.stringify(selectedKeys)}</output>
      <output aria-label="Activated collection key">{activated}</output>
      <output aria-label="Collection action count">{actions}</output>
    </section>
  );
}

function TakeoverExample() {
  const [long, setLong] = useState(false);
  const [step, setStep] = useState(1);
  const [cancelled, setCancelled] = useState(0);
  return (
    <section
      className="grid gap-4"
      data-functional-example="takeover"
      aria-label="Takeover example"
    >
      <h2>Takeover screen</h2>
      <Button variant="outline" onClick={() => setLong((value) => !value)}>
        Toggle long content
      </Button>
      <div className="flex h-96 min-h-0">
        <TakeoverScreen
          title={<h1>Example screen</h1>}
          description={<p>Screen description</p>}
          counter={<span>{step} of 3</span>}
          bodyRegionAttributes={{ 'data-testid': 'takeover-scroll-region' }}
          secondary={
            <Button variant="outline" onClick={() => setCancelled((count) => count + 1)}>
              Cancel takeover
            </Button>
          }
          primary={
            <Button onClick={() => setStep((value) => (value === 3 ? 1 : value + 1))}>
              Continue takeover
            </Button>
          }
        >
          {Array.from({ length: long ? 40 : 1 }, (_, index) => (
            <p key={index}>Screen body {index + 1}</p>
          ))}
        </TakeoverScreen>
      </div>
      <output aria-label="Takeover step">{step}</output>
      <output aria-label="Takeover cancelled count">{cancelled}</output>
    </section>
  );
}

export function FunctionalExamples({ slug }: { slug: string }) {
  return (
    <article className="component-page grid gap-8" data-testid="catalog-functional-examples">
      {slug === 'form' && (
        <>
          <FormExample />
          <AutosaveExample />
        </>
      )}
      {slug === 'screen' && <TakeoverExample />}
      {slug === 'confirm' && <ConfirmationExample />}
      {slug === 'collection' && <CollectionExample />}
    </article>
  );
}
