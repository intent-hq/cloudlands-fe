import { NotifyExample } from './notify-catalog-preview';
import { QuestionWizardExample } from './question-wizard-example';
import { NativeAttachmentExample, NativeLightboxExample } from './native-media-examples';
import { EditorNativeExample } from './editor-native-example';
import { CollapsiblePanelExample } from './collapsible-panel-example';
import { RecipesPage } from './recipes-page';
import { ReplaceAgentExample, TextareaConsumerExample } from './callback-consumer-examples';
import { DiagramFunctionalExamples } from './diagram-functional-examples';
import { CallbackDialogExamples } from './callback-dialog-examples';
import { MenuFocusExamples } from './menu-focus-examples';
import { EffortPickerExamples } from './effort-picker-examples';
import { ModelPickerExamples } from './model-picker-examples';
import { AgentAvatarExamples } from './agent-avatar-examples';
import { WorkspacePresentationExamples } from './workspace-presentation-examples';
import { ResourceIconExamples } from './resource-icon-examples';
import { SidebarActionsExamples } from './sidebar-actions-examples';
import { MentionNavigationExamples } from './mention-navigation-examples';
import { ChatTranscriptExamples } from './chat-transcript-examples';
import { ChatDisclosureExamples } from './chat-disclosure-examples';
import { ChatMetadataExamples } from './chat-metadata-examples';
import { ChatCommandExamples } from './chat-command-examples';
import { CommandPaletteExamples } from './command-palette-examples';
import { EditorIconExamples } from './editor-icon-examples';
import { BrowserDeviceFrameExamples } from './browser-device-frame-examples';
import { ChatReferenceExamples } from './chat-reference-examples';
import { ChatInlineExamples } from './chat-inline-examples';
import { ChatPreviewExamples } from './chat-preview-examples';
import { QueuedAttachmentExamples } from './queued-attachment-examples';
import { StreamingStatusExamples } from './streaming-status-examples';
import { SuggestedPromptExamples } from './suggested-prompt-examples';
import { AutomatedWakeExamples } from './automated-wake-examples';
import { AttributionHeaderExamples } from './attribution-header-examples';
import { InlinePermissionExamples } from './inline-permission-examples';
import { MarkdownCompositionExamples } from './markdown-composition-examples';
import { ChatVideoExamples } from './chat-video-examples';
import { MarkdownViewerExamples } from './markdown-viewer-examples';
import { ReasoningExamples } from './reasoning-examples';
import { ChatImageExamples } from './chat-image-examples';
import { MessageActionExamples } from './message-action-examples';
import { TranscriptCardExamples } from './transcript-card-examples';
import { ScriptActionExamples } from './script-action-examples';
import { OperationalWindowExamples } from './operational-window-examples';
import { ResponseGroupExamples } from './response-group-examples';
import { NavigationContentExamples } from './navigation-content-examples';
import { DetectedScriptExamples } from './detected-script-examples';
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
      {nativeExampleSlugs.includes(slug) && (
        <p className="type-caption text-muted-foreground" data-internal-example>
          Internal interaction example. Browser and visual acceptance remain pending.
        </p>
      )}
      {slug === 'question-wizard' && <QuestionWizardExample />}
      {slug === 'attachment-preview' && <NativeAttachmentExample />}
      {slug === 'image-lightbox' && <NativeLightboxExample kind="image" />}
      {slug === 'video-lightbox' && <NativeLightboxExample kind="video" />}
      {slug === 'local-editor' && <EditorNativeExample />}
      {slug === 'collapsible-panel' && <CollapsiblePanelExample />}
      {slug === 'recipes' && <RecipesPage />}
      {slug === 'settings-textarea' && <TextareaConsumerExample />}
      {slug === 'modal-heading-spacing' && <ReplaceAgentExample />}
      {slug === 'diagram-workbench' && <DiagramFunctionalExamples />}
      {slug === 'modals' && <CallbackDialogExamples />}
      {slug === 'menu' && <MenuFocusExamples />}
      {slug === 'effort-picker' && <EffortPickerExamples />}
      {slug === 'model-picker' && <ModelPickerExamples />}
      {slug === 'agent-avatar' && <AgentAvatarExamples />}
      {slug === 'sidebar-actions' && <SidebarActionsExamples />}
      {slug === 'mention-navigation' && <MentionNavigationExamples />}
      {slug === 'chat-transcript' && <ChatTranscriptExamples />}
      {slug === 'chat-disclosure' && <ChatDisclosureExamples />}
      {slug === 'chat-metadata' && <ChatMetadataExamples />}
      {slug === 'chat-command' && <ChatCommandExamples />}
      {slug === 'command-palette' && <CommandPaletteExamples />}
      {slug === 'editor-icons' && <EditorIconExamples />}
      {slug === 'browser-device-frame' && <BrowserDeviceFrameExamples />}
      {slug === 'chat-reference' && <ChatReferenceExamples />}
      {slug === 'chat-inline' && <ChatInlineExamples />}
      {slug === 'chat-preview' && <ChatPreviewExamples />}
      {slug === 'queued-attachments' && <QueuedAttachmentExamples />}
      {slug === 'streaming-status' && <StreamingStatusExamples />}
      {slug === 'suggested-prompts' && <SuggestedPromptExamples />}
      {slug === 'automated-wake' && <AutomatedWakeExamples />}
      {slug === 'attribution-headers' && <AttributionHeaderExamples />}
      {slug === 'inline-permission' && <InlinePermissionExamples />}
      {slug === 'markdown-composition' && <MarkdownCompositionExamples />}
      {slug === 'chat-video' && <ChatVideoExamples />}
      {slug === 'markdown-viewer' && <MarkdownViewerExamples />}
      {slug === 'reasoning' && <ReasoningExamples />}
      {slug === 'chat-image' && <ChatImageExamples />}
      {slug === 'message-actions' && <MessageActionExamples />}
      {slug === 'transcript-cards' && <TranscriptCardExamples />}
      {slug === 'script-actions' && <ScriptActionExamples />}
      {slug === 'operational-window' && <OperationalWindowExamples />}
      {slug === 'response-group' && <ResponseGroupExamples />}
      {slug === 'navigation-content' && <NavigationContentExamples />}
      {slug === 'detected-scripts' && <DetectedScriptExamples />}
      {workspacePresentationSlugs.includes(slug) && <WorkspacePresentationExamples slug={slug} />}
      {resourceIconSlugs.includes(slug) && <ResourceIconExamples slug={slug} />}
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

const nativeExampleSlugs = [
  'question-wizard',
  'attachment-preview',
  'image-lightbox',
  'video-lightbox',
  'local-editor',
  'collapsible-panel',
  'recipes',
];

const workspacePresentationSlugs = [
  'workspace-status-icon',
  'driving-client-indicator',
  'task-status-progress',
  'flame-graph',
];
const resourceIconSlugs = ['resource-icon-tile', 'browser-favicon'];

export function hasFunctionalExample(slug: string) {
  return [
    ...nativeExampleSlugs,
    ...workspacePresentationSlugs,
    ...resourceIconSlugs,
    'settings-textarea',
    'modal-heading-spacing',
    'modals',
    'menu',
    'effort-picker',
    'model-picker',
    'agent-avatar',
    'sidebar-actions',
    'mention-navigation',
    'chat-transcript',
    'chat-disclosure',
    'chat-metadata',
    'chat-command',
    'command-palette',
    'editor-icons',
    'browser-device-frame',
    'chat-reference',
    'chat-inline',
    'chat-preview',
    'queued-attachments',
    'streaming-status',
    'suggested-prompts',
    'automated-wake',
    'attribution-headers',
    'inline-permission',
    'markdown-composition',
    'chat-video',
    'markdown-viewer',
    'reasoning',
    'chat-image',
    'message-actions',
    'transcript-cards',
    'script-actions',
    'operational-window',
    'response-group',
    'navigation-content',
    'detected-scripts',
    'diagram-workbench',
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
