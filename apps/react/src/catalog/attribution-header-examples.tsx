// i18n-ignore (internal, unreleased catalog controls and caller observations)
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { FormField } from '@/components/patterns/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  AgentMessageAttributionHeader,
  type AgentMessageAttributionHeaderProps,
} from '@/features/chat/components/agent-message-attribution-header';
import {
  PrMonitorWakeAttributionHeader,
  type PrMonitorWakeAttributionHeaderProps,
} from '@/features/chat/components/pr-monitor-wake-attribution-header';
import { getAgentMessageAttribution } from '$lib/utils/agent-message-attribution';
import { getPrMonitorWakeAttribution } from '$lib/utils/pr-monitor-wake-attribution';
import { conversationMessageUrl } from '$shared/constants/intent-links';
import { CHIEF_WORKSPACE_ID, WorkspaceId } from '$shared/types/branded-ids';

function TextField({
  label,
  id,
  value,
  onChange,
}: {
  label: string;
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <FormField
      label={label}
      control={(field) => (
        <Input
          {...field}
          data-testid={id}
          value={value}
          maxLength={2048}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    />
  );
}

function BooleanField({
  label,
  id,
  value,
  onChange,
}: {
  label: string;
  id: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <FormField
      label={label}
      control={(field) => (
        <Switch
          {...field}
          ariaLabel={label}
          data-testid={id}
          checked={value}
          onCheckedChange={onChange}
        />
      )}
    />
  );
}

function ChoiceField<T extends string>({
  label,
  id,
  value,
  options,
  onChange,
}: {
  label: string;
  id: string;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
}) {
  return (
    <FormField
      label={label}
      control={(field) => (
        <ToggleGroup
          {...field}
          type="single"
          aria-label={label}
          data-testid={id}
          value={value}
          className="min-w-0 flex-wrap justify-start"
          onValueChange={(next) => {
            const selected = options.find((option) => option === next);
            if (selected) onChange(selected);
          }}
        >
          {options.map((option) => (
            <ToggleGroupItem key={option} value={option} data-testid={`${id}-${option}`}>
              {option}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}
    />
  );
}

function Output({ id, label, value }: { id: string; label: string; value: unknown }) {
  return (
    <output
      data-testid={id}
      aria-label={label}
      className="block min-w-0 max-w-full whitespace-pre-wrap wrap-anywhere"
    >
      {JSON.stringify(value, (_key, entry) => (entry === undefined ? '[undefined]' : entry), 2)}
    </output>
  );
}

function describeElement(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  return {
    tag: target.tagName,
    id: target.id,
    testId: target.getAttribute('data-testid'),
    nearestTestId: target.closest('[data-testid]')?.getAttribute('data-testid') ?? null,
    panelId: target.closest('[data-panel-id]')?.getAttribute('data-panel-id') ?? null,
    assistantPanels: Boolean(target.closest('[data-assistant-panels]')),
    assistantLayoutId:
      target.closest('[data-assistant-layout-id]')?.getAttribute('data-assistant-layout-id') ??
      null,
  };
}

type CallbackName =
  | 'ontoggle'
  | 'onPinnedActivate'
  | 'onOpenAssistantAgentFromEvent'
  | 'onOpenLink';
type Observation = { name: string; [key: string]: unknown };
const agentCallbacks: CallbackName[] = [
  'ontoggle',
  'onPinnedActivate',
  'onOpenAssistantAgentFromEvent',
  'onOpenLink',
];
const prCallbacks: CallbackName[] = ['onOpenLink'];

function useExercise() {
  const [mounted, setMounted] = useState(true);
  const [mountRevision, setMountRevision] = useState(0);
  const [width, setWidth] = useState('420');
  const [revisions, setRevisions] = useState<Record<CallbackName, number>>({
    ontoggle: 0,
    onPinnedActivate: 0,
    onOpenAssistantAgentFromEvent: 0,
    onOpenLink: 0,
  });
  const [observations, setObservations] = useState<{
    counts: Record<string, number>;
    callbacks: Observation[];
    parent: Observation[];
  }>({ counts: {}, callbacks: [], parent: [] });
  const identities = useRef({ ids: new WeakMap<Event, number>(), next: 0 });
  const capturedClick = useRef<MouseEvent | null>(null);

  const snapshot = useCallback((event: MouseEvent) => {
    let objectId = identities.current.ids.get(event);
    if (objectId === undefined) {
      objectId = ++identities.current.next;
      identities.current.ids.set(event, objectId);
    }
    return {
      objectId,
      type: event.type,
      isTrusted: event.isTrusted,
      sameAsCapturedClick: event === capturedClick.current,
      currentTarget: describeElement(event.currentTarget),
      target: describeElement(event.target),
      defaultPrevented: event.defaultPrevented,
      cancelBubble: event.cancelBubble,
      eventPhase: event.eventPhase,
      detail: event.detail,
      button: event.button,
      buttons: event.buttons,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
    };
  }, []);

  const record = useCallback(
    (name: CallbackName, revision: number, args: unknown[], result?: boolean) => {
      function snapshotArgument(argument: unknown): unknown {
        if (argument instanceof MouseEvent) return snapshot(argument);
        if (Array.isArray(argument)) return argument.map(snapshotArgument);
        if (argument && typeof argument === 'object') {
          return Object.fromEntries(
            Object.entries(argument).map(([key, value]) => [key, snapshotArgument(value)]),
          );
        }
        return argument;
      }
      // Snapshot synchronously: native currentTarget is cleared after listener dispatch.
      const observation: Observation = {
        name,
        callbackRevision: revision,
        mountRevision,
        argumentCount: args.length,
        arguments: args.map(snapshotArgument),
        result,
        capturedClick: capturedClick.current ? snapshot(capturedClick.current) : null,
      };
      setObservations((current) => ({
        ...current,
        counts: { ...current.counts, [name]: (current.counts[name] ?? 0) + 1 },
        callbacks: [...current.callbacks.slice(-11), observation],
      }));
    },
    [mountRevision, snapshot],
  );

  const observeParent = useCallback(
    (name: string, event: MouseEvent) => {
      const observation = { name, ...snapshot(event) };
      setObservations((current) => ({
        ...current,
        counts: { ...current.counts, [name]: (current.counts[name] ?? 0) + 1 },
        parent: [...current.parent.slice(-11), observation],
      }));
    },
    [snapshot],
  );

  const frameRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return;
      const cleanups = ['click', 'dblclick', 'pointerdown'].flatMap((type) =>
        [true, false].map((capture) => {
          const listener = (event: Event) => {
            if (!(event instanceof MouseEvent)) return;
            if (type === 'click' && capture) {
              // Retain only the last click. A microtask here can run between native
              // capture and target listeners, before the header receives the event.
              capturedClick.current = event;
            }
            observeParent(`native-${type}-${capture ? 'capture' : 'bubble'}`, event);
          };
          node.addEventListener(type, listener, capture);
          return () => node.removeEventListener(type, listener, capture);
        }),
      );
      return () => {
        cleanups.forEach((cleanup) => cleanup());
        capturedClick.current = null;
      };
    },
    [observeParent],
  );

  return {
    mounted,
    mountRevision,
    width,
    revisions,
    observations,
    frameRef,
    record,
    observeParent,
    setMounted: (value: boolean) => {
      setMounted(value);
      if (value) setMountRevision((revision) => revision + 1);
    },
    setWidth,
    remount: () => setMountRevision((revision) => revision + 1),
    replace: (name: CallbackName) =>
      setRevisions((current) => ({ ...current, [name]: current[name] + 1 })),
    clear: () => {
      capturedClick.current = null;
      setObservations({ counts: {}, callbacks: [], parent: [] });
    },
  };
}
type Exercise = ReturnType<typeof useExercise>;

function ExerciseControls({
  id,
  exercise,
  callbacks,
}: {
  id: string;
  exercise: Exercise;
  callbacks: CallbackName[];
}) {
  return (
    <>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <BooleanField
          id={`${id}-mounted`}
          label={`${id} header mounted`}
          value={exercise.mounted}
          onChange={exercise.setMounted}
        />
        <ChoiceField
          id={`${id}-width`}
          label={`${id} frame width`}
          value={exercise.width}
          options={['420', '720']}
          onChange={exercise.setWidth}
        />
      </div>
      <div className="flex min-w-0 flex-wrap gap-2">
        {callbacks.map((name) => (
          <Button
            key={name}
            data-testid={`${id}-replace-${name}`}
            onClick={() => exercise.replace(name)}
          >
            Replace {id} {name}
          </Button>
        ))}
        <Button
          data-testid={`${id}-remount`}
          disabled={!exercise.mounted}
          onClick={exercise.remount}
        >
          Remount {id} header
        </Button>
        <Button data-testid={`${id}-clear`} onClick={exercise.clear}>
          Clear {id} observations
        </Button>
      </div>
    </>
  );
}

function ObservedFrame({
  id,
  exercise,
  children,
}: {
  id: string;
  exercise: Exercise;
  children: ReactNode;
}) {
  const { frameRef, width, observeParent } = exercise;
  return (
    <div
      ref={frameRef}
      role="presentation"
      data-testid={`${id}-frame`}
      className="min-w-0 max-w-full"
      style={{ width: Number(width) }}
      onClick={(event) => observeParent('react-click-bubble', event.nativeEvent)}
      onDoubleClick={(event) => observeParent('react-dblclick-bubble', event.nativeEvent)}
    >
      {children}
      <Button data-testid={`${id}-sibling`}>Unrelated {id} sibling</Button>
    </div>
  );
}

function ExerciseOutputs({
  id,
  exercise,
  state,
}: {
  id: string;
  exercise: Exercise;
  state: unknown;
}) {
  return (
    <div className="grid min-w-0 gap-2">
      <Output
        id={`${id}-state`}
        label={`${id} caller state`}
        value={{
          mounted: exercise.mounted,
          mountRevision: exercise.mountRevision,
          width: exercise.width,
          callbackRevisions: exercise.revisions,
          inputs: state,
        }}
      />
      <Output
        id={`${id}-counts`}
        label={`${id} observation counts`}
        value={exercise.observations.counts}
      />
      <Output
        id={`${id}-callbacks`}
        label={`${id} latest twelve callback observations`}
        value={exercise.observations.callbacks}
      />
      <Output
        id={`${id}-parent-events`}
        label={`${id} latest twelve parent observations`}
        value={exercise.observations.parent}
      />
    </div>
  );
}

const initialAgentInput = {
  kind: 'agent' as 'agent' | 'chief',
  fromAgentId: 'agent-11111111-1111-4111-8111-111111111111',
  fromAgentName: 'Review agent',
  sourceMessageId: 'message-11111111-1111-4111-8111-111111111111',
  sourceUrl: 'valid' as 'valid' | 'absent',
  workspaceId: 'attribution-workspace-a',
  controlsId: 'attribution-agent-body-a',
  specialist: 'implementor',
  sourceClass: 'border border-border',
  className: 'bg-muted',
  panelId: 'attribution-inner-panel',
  assistantLayoutId: 'attribution-assistant-layout',
};

function AgentHeaderExercise() {
  const exercise = useExercise();
  const { record, revisions } = exercise;
  const [draft, setDraft] = useState(initialAgentInput);
  const [applied, setApplied] = useState(initialAgentInput);
  const [inputRevision, setInputRevision] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [specialistOverride, setSpecialistOverride] = useState(false);
  const [aliasEnabled, setAliasEnabled] = useState(false);
  const [assistantPanels, setAssistantPanels] = useState(true);
  const [handled, setHandled] = useState(true);

  const metadata = {
    type: applied.kind === 'chief' ? 'chief_message' : 'agent_message',
    fromAgentId: applied.fromAgentId,
    fromAgentName: applied.fromAgentName,
    ...(applied.kind === 'chief'
      ? {
          fromWorkspaceId: CHIEF_WORKSPACE_ID,
          sourceMessageId: applied.sourceMessageId,
          ...(applied.sourceUrl === 'valid'
            ? {
                sourceUrl: conversationMessageUrl(
                  CHIEF_WORKSPACE_ID,
                  applied.fromAgentId.trim(),
                  applied.sourceMessageId.trim(),
                ),
              }
            : {}),
        }
      : {}),
  };
  const attribution = getAgentMessageAttribution(metadata);
  const workspaceId = applied.workspaceId ? WorkspaceId(applied.workspaceId) : undefined;
  const ontoggle = useMemo<AgentMessageAttributionHeaderProps['ontoggle']>(
    () =>
      (...args) =>
        record('ontoggle', revisions.ontoggle, args),
    [record, revisions.ontoggle],
  );
  const onPinnedActivate = useMemo<
    NonNullable<AgentMessageAttributionHeaderProps['onPinnedActivate']>
  >(
    () =>
      (...args) =>
        record('onPinnedActivate', revisions.onPinnedActivate, args),
    [record, revisions.onPinnedActivate],
  );
  const onOpenAssistantAgentFromEvent = useMemo<
    AgentMessageAttributionHeaderProps['onOpenAssistantAgentFromEvent']
  >(
    () =>
      (...args) => {
        record(
          'onOpenAssistantAgentFromEvent',
          revisions.onOpenAssistantAgentFromEvent,
          args,
          handled,
        );
        return handled;
      },
    [handled, record, revisions.onOpenAssistantAgentFromEvent],
  );
  const onOpenLink = useMemo<AgentMessageAttributionHeaderProps['onOpenLink']>(
    () =>
      (...args) =>
        record('onOpenLink', revisions.onOpenLink, args),
    [record, revisions.onOpenLink],
  );
  function change<K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  return (
    <section
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4"
      aria-label="Agent and Chief attribution exercise"
      data-testid="agent-attribution-exercise"
    >
      <h3>Agent and Chief attribution</h3>
      <p className="type-caption text-muted-foreground">
        Apply caller metadata through the canonical extractor. Sender changes key a new header;
        workspace changes alone keep the initial route context until remount. Expanded is controlled
        only by the switch. The chosen assistant result is returned without navigating. When false,
        the component may dispatch its canonical action; these logs do not observe that action or
        navigation, and the real app-layout saga is not integrated.
      </p>
      <ChoiceField
        id="agent-kind"
        label="Sender kind"
        value={draft.kind}
        options={['agent', 'chief']}
        onChange={(value) => change('kind', value)}
      />
      <ChoiceField
        id="agent-source-url"
        label="Chief source metadata"
        value={draft.sourceUrl}
        options={['valid', 'absent']}
        onChange={(value) => change('sourceUrl', value)}
      />
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        {(
          [
            ['fromAgentId', 'Raw sender ID'],
            ['fromAgentName', 'Raw sender name'],
            ['sourceMessageId', 'Chief source message ID'],
            ['workspaceId', 'Agent route workspace ID (empty omits)'],
            ['controlsId', 'Agent disclosure controls ID'],
            ['specialist', 'Specialist override'],
            ['sourceClass', 'Agent source class'],
            ['className', 'Agent React className alias'],
            ['panelId', 'Nearest panel ID'],
            ['assistantLayoutId', 'Assistant layout ID'],
          ] as const
        ).map(([key, label]) => (
          <TextField
            key={key}
            id={`agent-${key}`}
            label={label}
            value={draft[key]}
            onChange={(value) => change(key, value)}
          />
        ))}
      </div>
      <div className="flex min-w-0 flex-wrap gap-2">
        <Button
          data-testid="agent-apply"
          onClick={() => {
            setApplied({ ...draft });
            setInputRevision((value) => value + 1);
          }}
        >
          Apply agent inputs
        </Button>
        <Button
          data-testid="agent-long-name"
          onClick={() =>
            change(
              'fromAgentName',
              'Review agent coordinating a detailed accessibility and keyboard interaction review across the workspace, with a long caller supplied name that needs to wrap while the disclosure control stays reachable.',
            )
          }
        >
          Set long sender name draft
        </Button>
      </div>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <BooleanField
          id="agent-expanded"
          label="Agent controlled expanded"
          value={expanded}
          onChange={setExpanded}
        />
        <BooleanField
          id="agent-pinned"
          label="Agent pinned callback enabled"
          value={pinned}
          onChange={setPinned}
        />
        <BooleanField
          id="agent-specialist-override"
          label="Use specialist override"
          value={specialistOverride}
          onChange={setSpecialistOverride}
        />
        <BooleanField
          id="agent-alias-enabled"
          label="Pass agent className alias"
          value={aliasEnabled}
          onChange={setAliasEnabled}
        />
        <BooleanField
          id="agent-assistant-panels"
          label="Assistant panel markers present"
          value={assistantPanels}
          onChange={setAssistantPanels}
        />
        <BooleanField
          id="agent-handled"
          label="Assistant callback returns handled"
          value={handled}
          onChange={setHandled}
        />
      </div>
      <ExerciseControls id="agent" exercise={exercise} callbacks={agentCallbacks} />
      <ObservedFrame id="agent" exercise={exercise}>
        <div
          data-panel-id="attribution-outer-panel"
          data-assistant-panels={assistantPanels ? '' : undefined}
          data-assistant-layout-id={assistantPanels ? applied.assistantLayoutId : undefined}
        >
          <div data-panel-id={applied.panelId}>
            {exercise.mounted && attribution && (
              <AgentMessageAttributionHeader
                key={`${exercise.mountRevision}:${attribution.fromAgentId}`}
                attribution={attribution}
                expanded={expanded}
                controlsId={applied.controlsId}
                ontoggle={ontoggle}
                onPinnedActivate={pinned ? onPinnedActivate : undefined}
                specialist={specialistOverride ? applied.specialist : null}
                class={applied.sourceClass}
                className={aliasEnabled ? applied.className : undefined}
                workspaceId={workspaceId}
                onOpenAssistantAgentFromEvent={onOpenAssistantAgentFromEvent}
                onOpenLink={onOpenLink}
              />
            )}
            {exercise.mounted && !attribution && (
              <p data-testid="agent-no-attribution">
                The canonical extractor returned no attribution.
              </p>
            )}
            {exercise.mounted && attribution && (
              <div id={applied.controlsId} hidden={!expanded} data-testid="agent-disclosure-body">
                Caller-owned disclosure content. Toggle callbacks are observations; use the expanded
                switch to change this content.
              </div>
            )}
          </div>
        </div>
      </ObservedFrame>
      <ExerciseOutputs
        id="agent"
        exercise={exercise}
        state={{
          applied,
          inputRevision,
          metadata,
          attribution,
          workspaceId,
          expanded,
          pinned,
          specialistOverride,
          aliasEnabled,
          assistantPanels,
          handled,
          senderKey: attribution?.fromAgentId,
        }}
      />
    </section>
  );
}

const initialPrInput = {
  repo: 'intent-hq/intent',
  prNumber: '17',
  url: '',
  workspaceId: 'attribution-workspace-a',
  sourceClass: 'border border-border',
  className: 'bg-muted',
  omitRepo: false,
  omitNumber: false,
  omitUrl: false,
};

function PrHeaderExercise() {
  const exercise = useExercise();
  const { record, revisions } = exercise;
  const [draft, setDraft] = useState(initialPrInput);
  const [applied, setApplied] = useState(initialPrInput);
  const [inputRevision, setInputRevision] = useState(0);
  const [sourceClassEnabled, setSourceClassEnabled] = useState(true);
  const [aliasEnabled, setAliasEnabled] = useState(false);
  const metadata = {
    type: 'pr_monitor_wake',
    monitorId: 'attribution-monitor',
    reason: 'changed',
    ...(applied.omitRepo ? {} : { repo: applied.repo }),
    ...(applied.omitNumber
      ? {}
      : { prNumber: applied.prNumber === '' ? '' : Number(applied.prNumber) }),
    ...(applied.omitUrl ? {} : { url: applied.url }),
  };
  const attribution = getPrMonitorWakeAttribution(metadata);
  const workspaceId = applied.workspaceId ? WorkspaceId(applied.workspaceId) : undefined;
  const onOpenLink = useMemo<PrMonitorWakeAttributionHeaderProps['onOpenLink']>(
    () =>
      (...args) =>
        record('onOpenLink', revisions.onOpenLink, args),
    [record, revisions.onOpenLink],
  );
  function change<K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  return (
    <section
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4"
      aria-label="PR monitor attribution exercise"
      data-testid="pr-attribution-exercise"
    >
      <h3>PR monitor attribution</h3>
      <p className="type-caption text-muted-foreground">
        Metadata goes through the canonical extractor, including empty or omitted fields. The real
        Store has no workspace record for these caller IDs. Route context alone does not populate
        one. A mounted header retains its initial workspace lookup; remount to capture new context.
        The link callback records its arguments and does not open a browser.
      </p>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        {(
          [
            ['repo', 'PR repository'],
            ['prNumber', 'PR number'],
            ['url', 'PR metadata URL'],
            ['workspaceId', 'PR route workspace ID (empty omits)'],
            ['sourceClass', 'PR source class'],
            ['className', 'PR React className alias'],
          ] as const
        ).map(([key, label]) => (
          <TextField
            key={key}
            id={`pr-${key}`}
            label={label}
            value={draft[key]}
            onChange={(value) => change(key, value)}
          />
        ))}
        {(
          [
            ['omitRepo', 'Omit repository metadata'],
            ['omitNumber', 'Omit PR number metadata'],
            ['omitUrl', 'Omit URL metadata'],
          ] as const
        ).map(([key, label]) => (
          <BooleanField
            key={key}
            id={`pr-${key}`}
            label={label}
            value={draft[key]}
            onChange={(value) => change(key, value)}
          />
        ))}
      </div>
      <div>
        <Button
          data-testid="pr-apply"
          onClick={() => {
            setApplied({ ...draft });
            setInputRevision((value) => value + 1);
          }}
        >
          Apply PR inputs
        </Button>
      </div>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <BooleanField
          id="pr-source-class-enabled"
          label="Pass PR source class"
          value={sourceClassEnabled}
          onChange={setSourceClassEnabled}
        />
        <BooleanField
          id="pr-alias-enabled"
          label="Pass PR className alias"
          value={aliasEnabled}
          onChange={setAliasEnabled}
        />
      </div>
      <ExerciseControls id="pr" exercise={exercise} callbacks={prCallbacks} />
      <ObservedFrame id="pr" exercise={exercise}>
        {exercise.mounted && attribution && (
          <PrMonitorWakeAttributionHeader
            key={exercise.mountRevision}
            attribution={attribution}
            workspaceId={workspaceId}
            onOpenLink={onOpenLink}
            class={sourceClassEnabled ? applied.sourceClass : undefined}
            className={aliasEnabled ? applied.className : undefined}
          />
        )}
        {exercise.mounted && !attribution && (
          <p data-testid="pr-no-attribution">The canonical extractor returned no attribution.</p>
        )}
      </ObservedFrame>
      <ExerciseOutputs
        id="pr"
        exercise={exercise}
        state={{
          applied,
          inputRevision,
          metadata,
          attribution,
          workspaceId,
          sourceClassEnabled,
          aliasEnabled,
        }}
      />
    </section>
  );
}

export function AttributionHeaderExamples() {
  return (
    <section
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-8"
      data-functional-example="attribution-headers"
      aria-label="Attribution header exercises"
    >
      <h2>Attribution headers</h2>
      <p className="type-caption text-muted-foreground">
        Internal, unreleased exercises using the actual headers, canonical metadata helpers and the
        existing Store. No agent, permission, provider or workspace records are inserted. Hydrated
        state, product navigation, paired visual parity and full-motion behavior remain unverified.
        Native parent listeners and React bubbling are recorded separately; React may cancel an
        event after it has passed a native parent listener. Every history keeps the latest twelve
        full snapshots. Undefined values are displayed as [undefined].
      </p>
      <AgentHeaderExercise />
      <PrHeaderExercise />
    </section>
  );
}
