import { NotifyExample } from './notify-catalog-preview';
// Local examples exercise production patterns independently of reference appearance fixtures.
// i18n-ignore (deterministic internal catalog example content)
import { ConfirmationExample } from './confirmation-example';
import { NativeAvatarExample, NativeClipboardExample, NativeFileExample } from './native-examples';
import { SettingsHighlightExample } from './settings-highlight-example';
import { ScrollAreaExample } from './navigation-help-catalog-preview';
import {
  PublicTooltipExample,
  RichTooltipExample,
  SelectWrapperExample,
} from './overlay-interaction-examples';
import { SidebarPersistenceExample } from './sidebar-catalog-preview';
import { ZoomMediaExample } from './media-catalog-preview';
import { DisplayWidgetExample } from './display-widget-examples';
import { displayWidgetSlugs } from './additional-catalog-entries';
import { useEffect, useRef, useState } from 'react';
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
  const [hold, setHold] = useState(false);
  const [ignoreEnter, setIgnoreEnter] = useState(false);
  const [ignoreModifiedEnter, setIgnoreModifiedEnter] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [status, setStatus] = useState('idle');
  const [submissionError, setSubmissionError] = useState('');
  const pending = useRef<{ resolve: () => void; reject: (error: Error) => void } | null>(null);
  useEffect(() => () => pending.current?.resolve(), []);
  return (
    <section
      className="grid gap-4"
      data-functional-example="form-submit"
      aria-label="Form submission example"
    >
      <h2>Form submission</h2>
      <Switch aria-label="Pause form editing" checked={busy} onCheckedChange={setBusy} />
      <Switch aria-label="Hold form submission" checked={hold} onCheckedChange={setHold} />
      <Switch aria-label="Ignore Enter" checked={ignoreEnter} onCheckedChange={setIgnoreEnter} />
      <Switch
        aria-label="Ignore modified Enter"
        checked={ignoreModifiedEnter}
        onCheckedChange={setIgnoreModifiedEnter}
      />
      <div className="flex flex-wrap gap-2">
        <Button disabled={status !== 'pending'} onClick={() => pending.current?.resolve()}>
          Release form submission
        </Button>
        <Button
          disabled={status !== 'pending'}
          onClick={() => pending.current?.reject(new Error('Example submission rejected'))}
        >
          Reject form submission
        </Button>
      </div>
      <Form
        aria-label="Project submission form"
        busy={busy}
        enterKey={ignoreEnter ? 'ignore' : 'submit'}
        modEnter={ignoreModifiedEnter ? 'ignore' : 'submit'}
        onSubmit={async () => {
          setAttempts((count) => count + 1);
          setStatus('validating');
          setSubmissionError('');
          try {
            const accepted = await form.submit(async (values) => {
              if (hold) {
                setStatus('pending');
                await new Promise<void>((resolve, reject) => {
                  pending.current = { resolve, reject };
                });
              }
              setSaved({ ...values });
              setSubmissions((count) => count + 1);
            });
            setStatus(accepted ? 'saved' : 'invalid');
          } catch (error) {
            // The caller presents useForm's rejection; Form still owns its pending lifecycle.
            setStatus('rejected');
            setSubmissionError(error instanceof Error ? error.message : String(error));
          } finally {
            pending.current = null;
          }
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
      <output aria-label="Form submission attempts">{attempts}</output>
      <output aria-label="Form submission status">{status}</output>
      <output aria-label="Form submission error">{submissionError}</output>
      <output aria-label="Form hook submitting">{String(form.submitting)}</output>
      <output aria-label="Saved project">{JSON.stringify(saved)}</output>
    </section>
  );
}

function AutosaveExample() {
  const [saved, setSaved] = useState('Workspace');
  const [saves, setSaves] = useState(0);
  const [disabled, setDisabled] = useState(false);
  const [failNext, setFailNext] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [externalUpdates, setExternalUpdates] = useState(0);
  const [scheduled, setScheduled] = useState(false);
  const externalVersion = useRef(0);
  const externalTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(externalTimer.current), []);
  function updateExternally() {
    externalVersion.current += 1;
    setSaved(`External workspace ${externalVersion.current}`);
    setExternalUpdates(externalVersion.current);
    setScheduled(false);
  }
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
      <Switch aria-label="Fail next autosave" checked={failNext} onCheckedChange={setFailNext} />
      <AutoSaveField
        value={saved}
        originalValue={saved}
        disabled={disabled}
        canSave={(value) => value.trim().length > 0}
        prepare={(value) => value.trim()}
        onSave={async (value) => {
          setAttempts((count) => count + 1);
          await Promise.resolve();
          if (failNext) {
            setFailNext(false);
            throw new Error('Example autosave rejected');
          }
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
      <p>
        Retry a failed save with Control-S or Command-S. External update buttons keep pointer focus
        in the draft.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onPointerDown={(event) => event.preventDefault()}
          onClick={updateExternally}
        >
          Update autosave externally
        </Button>
        <Button
          variant="outline"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            clearTimeout(externalTimer.current);
            setScheduled(true);
            externalTimer.current = setTimeout(updateExternally, 250);
          }}
        >
          Schedule external autosave update
        </Button>
      </div>
      <output aria-label="Autosave count">{saves}</output>
      <output aria-label="Autosave attempts">{attempts}</output>
      <output aria-label="Autosave external updates">{externalUpdates}</output>
      <output aria-label="Autosave external update scheduled">{String(scheduled)}</output>
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
  const [items, setItems] = useState(exampleItems);
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
        items={items}
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
                <Button
                  size="sm"
                  onClick={() =>
                    setItems((current) => current.filter((entry) => entry.id !== item.id))
                  }
                >
                  Remove {item.name}
                </Button>
                <Button
                  size="sm"
                  onClick={() =>
                    setItems((current) => [
                      item,
                      ...current.filter((entry) => entry.id !== item.id),
                    ])
                  }
                >
                  Move {item.name} to start
                </Button>
              </>
            }
          />
        )}
      />
      <output aria-label="Selected collection keys">{JSON.stringify(selectedKeys)}</output>
      <output aria-label="Activated collection key">{activated}</output>
      <output aria-label="Collection action count">{actions}</output>
      <output aria-label="Collection order">{JSON.stringify(items.map((item) => item.id))}</output>
      <Button variant="outline" onClick={() => setItems(exampleItems)}>
        Restore collection
      </Button>
    </section>
  );
}

const virtualItems = Array.from({ length: 250 }, (_, index) => ({
  id: `item-${index + 1}`,
  name: `Item ${index + 1}`,
}));

function VirtualCollectionExample() {
  const [activated, setActivated] = useState('none');
  return (
    <section
      className="grid gap-4"
      data-functional-example="virtual-collection"
      aria-label="Virtual collection example"
    >
      <h2>Virtual collection</h2>
      <ListView
        items={virtualItems}
        getKey={(item) => item.id}
        getText={(item) => item.name}
        ariaLabel="Virtual collection"
        className="h-64"
        virtualize
        onActivate={(item) => setActivated(item.id)}
        row={({ item }) => <ListRow title={item.name} />}
      />
      <output aria-label="Virtual collection activated key">{activated}</output>
    </section>
  );
}

function FormKeyboardOverrideExample() {
  const [keys, setKeys] = useState<string[]>([]);
  const [submissions, setSubmissions] = useState(0);
  return (
    <section
      className="grid gap-4"
      data-functional-example="form-keyboard-override"
      aria-label="Form keyboard override example"
    >
      <h2>Caller-owned form keyboard handling</h2>
      <Form
        aria-label="Keyboard override form"
        onKeyDown={(event) =>
          setKeys((current) => [
            ...current,
            `${event.ctrlKey || event.metaKey ? 'Mod+' : ''}${event.key}`,
          ])
        }
        onSubmit={() => setSubmissions((count) => count + 1)}
      >
        <FormField label="Override notes" control={(field) => <Textarea {...field} />} />
        <Button type="submit">Submit override form</Button>
      </Form>
      <output aria-label="Override key callbacks">{JSON.stringify(keys)}</output>
      <output aria-label="Override submission count">{submissions}</output>
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
      {(slug === 'toast' || slug === 'notify') && <NotifyExample />}
      {slug === 'form' && (
        <>
          <FormExample />
          <AutosaveExample />
          <FormKeyboardOverrideExample />
        </>
      )}
      {slug === 'screen' && <TakeoverExample />}
      {slug === 'confirm' && <ConfirmationExample />}
      {slug === 'collection' && (
        <>
          <CollectionExample />
          <VirtualCollectionExample />
        </>
      )}
      {slug === 'copy-input' && <NativeClipboardExample />}
      {slug === 'file-input' && <NativeFileExample />}
      {slug === 'principal-avatar' && <NativeAvatarExample />}
      {slug === 'settings' && <SettingsHighlightExample />}
      {slug === 'tooltip-rich' && <RichTooltipExample />}
      {slug === 'tooltip' && <PublicTooltipExample />}
      {slug === 'select' && <SelectWrapperExample />}
      {slug === 'sidebar' && <SidebarPersistenceExample />}
      {slug === 'scroll-area' && <ScrollAreaExample />}
      {slug === 'zoom-pan-viewport' && <ZoomMediaExample />}
      {displayWidgetSlugs.some((value) => value === slug) && <DisplayWidgetExample slug={slug} />}
    </article>
  );
}

export function hasFunctionalExample(slug: string) {
  return [
    'toast',
    'notify',
    'form',
    'collection',
    'confirm',
    'screen',
    'copy-input',
    'file-input',
    'principal-avatar',
    'settings',
    'tooltip-rich',
    'tooltip',
    'select',
    'sidebar',
    'scroll-area',
    'zoom-pan-viewport',
    ...displayWidgetSlugs,
  ].includes(slug);
}
