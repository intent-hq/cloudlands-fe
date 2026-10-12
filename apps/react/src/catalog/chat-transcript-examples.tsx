// i18n-ignore (internal catalog caller props, controls and callback records, not product copy)
import { useCallback, useState, type ComponentProps, type ReactNode } from 'react';
import { FormField } from '@/components/patterns/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ConversationTurnGap } from '@/features/chat/components/conversation-turn-gap';
import { EffortChangeNotice } from '@/features/chat/components/effort-change-notice';
import { ModelChangeNotice } from '@/features/chat/components/model-change-notice';
import { NewMessagesDivider } from '@/features/chat/components/new-messages-divider';
import { ProviderRehomedNotice } from '@/features/chat/components/provider-rehomed-notice';
import { QuestionsDismissedNotice } from '@/features/chat/components/questions-dismissed-notice';
import { ScrollToBottomButton } from '@/features/chat/components/scroll-to-bottom-button';
import { ToolStatusIcon } from '@/features/chat/components/tool-status-icon';

// These are ordinary component inputs, never catalog entries or synthesized daemon events.
const modelCases = {
  raw: { from: 'org/model:alpha', to: 'org/model:beta' },
  canonical: {
    from: 'sonnet4.6',
    to: 'gpt-5-codex',
    fromProvider: 'auggie',
    toProvider: 'codex',
  },
  'unknown-providers': {
    from: 'org/Unlisted-Model:A',
    to: 'org/Unlisted-Model:B',
    fromProvider: 'provider/Unlisted-A',
    toProvider: 'provider/Unlisted-B',
  },
  defaults: { from: null, to: null, fromProvider: 'auggie', toProvider: 'codex' },
  'from-null': { from: null, to: 'gpt-5-codex', fromProvider: 'auggie', toProvider: 'codex' },
  'to-null': { from: 'sonnet4.6', to: null, fromProvider: 'auggie', toProvider: 'codex' },
  incomplete: { from: null, to: 'org/model:beta' },
} satisfies Record<string, ComponentProps<typeof ModelChangeNotice>['notice']>;

const providerCases = {
  disabled: {
    reason: 'provider_disabled',
    from: 'sonnet4.6',
    to: 'gpt-5-codex',
    fromProvider: 'auggie',
    toProvider: 'codex',
  },
  'unknown-providers': {
    reason: 'provider_disabled',
    from: 'org/Unlisted-Model:A',
    to: 'org/Unlisted-Model:B',
    fromProvider: 'provider/Unlisted-A',
    toProvider: 'provider/Unlisted-B',
  },
  defaults: {
    reason: 'provider_disabled',
    from: null,
    to: null,
    fromProvider: 'auggie',
    toProvider: 'codex',
  },
  'missing-from-provider': {
    reason: 'provider_disabled',
    from: 'sonnet4.6',
    to: 'gpt-5-codex',
    toProvider: 'codex',
  },
  'missing-to-provider': {
    reason: 'provider_disabled',
    from: 'sonnet4.6',
    to: 'gpt-5-codex',
    fromProvider: 'auggie',
  },
  'unknown-reason': {
    reason: 'caller-reason',
    from: 'sonnet4.6',
    to: 'gpt-5-codex',
    fromProvider: 'auggie',
    toProvider: 'codex',
  },
} satisfies Record<string, ComponentProps<typeof ProviderRehomedNotice>['notice']>;

const effortCases = {
  auto: { from: null, to: 'high' },
  none: { from: 'none', to: 'max' },
  'canonical-case': { from: 'MiNiMaL', to: 'XHIGH' },
  provider: { from: 'provider/Deep-Think', to: 'custom-Mixed_CASE' },
  'incomplete-from': { from: undefined, to: 'high' },
  'incomplete-to': { from: 'low', to: undefined },
} satisfies Record<string, ComponentProps<typeof EffortChangeNotice>['notice']>;

const defaultGap = {
  currentIsEventNotification: false,
  currentHasAssistantMessages: true,
  nextIsEventNotification: false,
};
const lowerSeams = {
  nextHasUserMessage: true,
  nextIsEventNotification: true,
  compactOperationalSeam: true,
  zeroToolSeam: true,
  batchedDeliverySeam: true,
};
// Finite combinations expose source precedence without reimplementing its spacing decision.
const gapCases = {
  ordinary: defaultGap,
  'current-event': {
    ...defaultGap,
    currentIsEventNotification: true,
    currentHasAssistantMessages: false,
  },
  'current-event-with-assistant': { ...defaultGap, currentIsEventNotification: true },
  'next-user': { ...defaultGap, nextHasUserMessage: true },
  'event-over-user': { ...defaultGap, nextIsEventNotification: true, nextHasUserMessage: true },
  'compact-over-user': { ...defaultGap, compactOperationalSeam: true, nextHasUserMessage: true },
  'zero-over-compact': {
    ...defaultGap,
    compactOperationalSeam: true,
    zeroToolSeam: true,
    nextHasUserMessage: true,
  },
  'batched-over-zero': { ...defaultGap, ...lowerSeams },
  'cards-over-batched': { ...defaultGap, ...lowerSeams, subscriptionCardSeam: 'cards' },
  'content-over-batched': { ...defaultGap, ...lowerSeams, subscriptionCardSeam: 'content' },
  'attention-over-cards': {
    ...defaultGap,
    ...lowerSeams,
    subscriptionCardSeam: 'cards',
    attentionQuestionAnswerSeam: true,
  },
} satisfies Record<string, ComponentProps<typeof ConversationTurnGap>>;

function BooleanField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <FormField
      label={label}
      control={(field) => (
        <Switch {...field} ariaLabel={label} checked={value} onCheckedChange={onChange} />
      )}
    />
  );
}

function CaseSelect<K extends string>({
  label,
  cases,
  value,
  onChange,
}: {
  label: string;
  cases: Record<K, unknown>;
  value: K;
  onChange: (value: K) => void;
}) {
  const items = Object.keys(cases).map((key) => ({ value: key, label: key }));
  return (
    <FormField
      label={label}
      control={(field) => (
        <Select
          value={value}
          items={items}
          onValueChange={(next) => {
            if (Object.hasOwn(cases, next)) onChange(next as K);
          }}
        >
          <SelectTrigger {...field} aria-label={label}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent portal>
            <SelectGroup>
              {items.map((item) => (
                <SelectItem key={item.value} {...item} />
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      )}
    />
  );
}

function Exercise({
  id,
  name,
  inputs,
  observations,
  controls,
  children,
}: {
  id: string;
  name: string;
  inputs: unknown;
  observations?: Record<string, unknown>;
  controls?: ReactNode;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(true);
  const [revision, setRevision] = useState(0);
  return (
    <section
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3"
      aria-label={`${name} exercise`}
      data-testid={id}
    >
      <h3>{name}</h3>
      {controls}
      <div className="flex min-w-0 flex-wrap items-end gap-3">
        <BooleanField label={`Mount ${name}`} value={mounted} onChange={setMounted} />
        <Button disabled={!mounted} onClick={() => setRevision((current) => current + 1)}>
          Remount {name}
        </Button>
      </div>
      {mounted && (
        <div key={revision} className="min-w-0" data-testid={`${id}-leaf`}>
          {children}
        </div>
      )}
      <output
        className="block min-w-0 whitespace-pre-wrap wrap-anywhere"
        aria-label={`${name} state`}
        data-testid={`${id}-state`}
      >
        {JSON.stringify(
          { mounted, revision, inputs, ...observations },
          (_key, value) => (value === undefined ? '[undefined]' : value),
          2,
        )}
      </output>
    </section>
  );
}

function ScrollExercise() {
  const [disabled, setDisabled] = useState(false);
  const [floating, setFloating] = useState(false);
  const [identity, setIdentity] = useState<'primary' | 'replacement'>('primary');
  const [callbacks, setCallbacks] = useState<{ sequence: number; identity: string }[]>([]);
  const [nativeEvents, setNativeEvents] = useState<
    { type: string; detail: number; key: string | null; isTrusted: boolean }[]
  >([]);
  // Both actual callbacks keep their identity across prop updates and leaf remounts.
  const primary = useCallback(() => {
    setCallbacks((current) => [...current, { sequence: current.length + 1, identity: 'primary' }]);
  }, []);
  const replacement = useCallback(() => {
    setCallbacks((current) => [
      ...current,
      { sequence: current.length + 1, identity: 'replacement' },
    ]);
  }, []);
  return (
    <Exercise
      id="chat-scroll"
      name="ScrollToBottomButton"
      inputs={{ disabled, floating, onClick: identity }}
      observations={{ callbackCount: callbacks.length, callbacks, nativeEvents }}
      controls={
        <>
          <BooleanField label="Disable scroll button" value={disabled} onChange={setDisabled} />
          <BooleanField label="Float scroll button" value={floating} onChange={setFloating} />
          <FormField
            label="Scroll callback identity"
            control={(field) => (
              <ToggleGroup
                id={field.id}
                type="single"
                aria-label="Scroll callback identity"
                className="min-w-0 flex-wrap justify-start"
                value={identity}
                onValueChange={(next) => {
                  if (next === 'primary' || next === 'replacement') setIdentity(next);
                }}
              >
                <ToggleGroupItem value="primary">primary</ToggleGroupItem>
                <ToggleGroupItem value="replacement">replacement</ToggleGroupItem>
              </ToggleGroup>
            )}
          />
        </>
      }
    >
      <div
        className="flex min-w-0 items-center"
        onClickCapture={(event) =>
          setNativeEvents((current) => [
            ...current,
            {
              type: event.nativeEvent.type,
              detail: event.detail,
              key: null,
              isTrusted: event.nativeEvent.isTrusted,
            },
          ])
        }
        onKeyDownCapture={(event) =>
          setNativeEvents((current) => [
            ...current,
            {
              type: event.nativeEvent.type,
              detail: event.detail,
              key: event.key,
              isTrusted: event.nativeEvent.isTrusted,
            },
          ])
        }
      >
        <ScrollToBottomButton
          disabled={disabled}
          floating={floating}
          onClick={identity === 'primary' ? primary : replacement}
        />
      </div>
    </Exercise>
  );
}

export function ChatTranscriptExamples() {
  const [modelCase, setModelCase] = useState<keyof typeof modelCases>('raw');
  const [providerCase, setProviderCase] = useState<keyof typeof providerCases>('disabled');
  const [effortCase, setEffortCase] = useState<keyof typeof effortCases>('auto');
  const [gapCase, setGapCase] = useState<keyof typeof gapCases>('ordinary');
  const [status, setStatus] = useState<ComponentProps<typeof ToolStatusIcon>['status']>('running');
  const [title, setTitle] = useState('Caller supplied dismissal title');
  const [useTitle, setUseTitle] = useState(true);
  const [fallback, setFallback] = useState('Caller supplied notice fallback');
  const [useFallback, setUseFallback] = useState(false);
  const [workspace, setWorkspace] = useState('');
  const fallbackText = useFallback ? fallback : undefined;
  const workspaceId = workspace || undefined;
  const modelProps = { notice: modelCases[modelCase], workspaceId, fallbackText };
  const providerProps = { notice: providerCases[providerCase], workspaceId, fallbackText };
  const effortProps = { notice: effortCases[effortCase], fallbackText };
  return (
    <section
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6"
      data-functional-example="chat-transcript"
    >
      <h2>Chat transcript caller props</h2>
      <p className="type-caption text-muted-foreground">
        Internal component exercise. Notice props are caller data; model and provider names come
        from the real canonical store, including its unresolved raw-name fallbacks. This page does
        not load catalogs or send daemon events. Native and source appearance acceptance is
        separate. JSON marks undefined values as [undefined]; omitted optional props retain source
        defaults. The scroll callback has no arguments or public ref.
      </p>
      <Exercise id="chat-divider" name="NewMessagesDivider" inputs={{}}>
        <NewMessagesDivider />
      </Exercise>
      <Exercise
        id="chat-questions"
        name="QuestionsDismissedNotice"
        inputs={{ title: useTitle ? title : undefined }}
        controls={
          <>
            <FormField
              label="Questions notice title"
              control={(field) => (
                <Input
                  {...field}
                  value={title}
                  onChange={(event) => setTitle(event.currentTarget.value)}
                />
              )}
            />
            <BooleanField label="Use questions title" value={useTitle} onChange={setUseTitle} />
          </>
        }
      >
        <QuestionsDismissedNotice title={useTitle ? title : undefined} />
      </Exercise>
      <FormField
        label="Notice fallback text"
        control={(field) => (
          <Input
            {...field}
            value={fallback}
            onChange={(event) => setFallback(event.currentTarget.value)}
          />
        )}
      />
      <BooleanField
        label="Use custom notice fallback"
        value={useFallback}
        onChange={setUseFallback}
      />
      <FormField
        label="Notice workspace ID"
        description="Empty omits workspaceId. This input does not create or load a workspace."
        control={(field) => (
          <Input
            {...field}
            value={workspace}
            onChange={(event) => setWorkspace(event.currentTarget.value)}
          />
        )}
      />
      <Exercise
        id="chat-model"
        name="ModelChangeNotice"
        inputs={modelProps}
        observations={{ case: modelCase }}
        controls={
          <CaseSelect
            label="Model notice case"
            cases={modelCases}
            value={modelCase}
            onChange={setModelCase}
          />
        }
      >
        <ModelChangeNotice {...modelProps} />
      </Exercise>
      <Exercise
        id="chat-provider"
        name="ProviderRehomedNotice"
        inputs={providerProps}
        observations={{ case: providerCase }}
        controls={
          <CaseSelect
            label="Provider notice case"
            cases={providerCases}
            value={providerCase}
            onChange={setProviderCase}
          />
        }
      >
        <ProviderRehomedNotice {...providerProps} />
      </Exercise>
      <Exercise
        id="chat-effort"
        name="EffortChangeNotice"
        inputs={effortProps}
        observations={{ case: effortCase }}
        controls={
          <CaseSelect
            label="Effort notice case"
            cases={effortCases}
            value={effortCase}
            onChange={setEffortCase}
          />
        }
      >
        <EffortChangeNotice {...effortProps} />
      </Exercise>
      <Exercise
        id="chat-tool"
        name="ToolStatusIcon"
        inputs={{ status }}
        controls={
          <FormField
            label="Tool status"
            control={(field) => (
              <ToggleGroup
                id={field.id}
                type="single"
                aria-label="Tool status"
                className="min-w-0 flex-wrap justify-start"
                value={status}
                onValueChange={(next) => {
                  if (next === 'running' || next === 'completed' || next === 'error')
                    setStatus(next);
                }}
              >
                <ToggleGroupItem value="running">running</ToggleGroupItem>
                <ToggleGroupItem value="completed">completed</ToggleGroupItem>
                <ToggleGroupItem value="error">error</ToggleGroupItem>
              </ToggleGroup>
            )}
          />
        }
      >
        <ToolStatusIcon status={status} />
      </Exercise>
      <ScrollExercise />
      <Exercise
        id="chat-gap"
        name="ConversationTurnGap"
        inputs={gapCases[gapCase]}
        observations={{ case: gapCase }}
        controls={
          <CaseSelect
            label="Gap combination"
            cases={gapCases}
            value={gapCase}
            onChange={setGapCase}
          />
        }
      >
        <p data-testid="chat-gap-before">Previous turn boundary</p>
        <ConversationTurnGap {...gapCases[gapCase]} />
        <p data-testid="chat-gap-after">Following turn boundary</p>
      </Exercise>
    </section>
  );
}
