// i18n-ignore (internal catalog caller inputs and observations, not released product copy)
import { useCallback, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { FormField } from '@/components/patterns/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  AutomatedWakeCardHeader,
  type AutomatedWakeCardHeaderProps,
} from '@/features/chat/components/automated-wake-card-header';
import {
  getAutomatedWakePresentation,
  type AutomatedWakePresentation,
} from '$lib/components/chat/automated-wake-presentation';
import { WorkspaceStatus, type AgentMessage, type Workspace } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';

const initialInput = {
  kind: 'hook' as AutomatedWakePresentation['kind'],
  hookName: 'Build watcher',
  hookReason: 'dispatched',
  hookStillActive: 'true' as 'true' | 'false' | 'undefined',
  scriptName: 'Build',
  scriptReason: 'finished',
  repo: 'intent-hq/intent',
  prNumber: '17',
  url: '',
  workspaceMode: 'present' as 'present' | 'null' | 'undefined',
  workspaceId: 'wake-workspace-a',
  repositoryOwner: 'intent-hq',
  repositoryName: 'intent',
  controlsId: 'automated-wake-body-a',
};
type CallerInput = typeof initialInput;
type TextInputKey = Exclude<
  keyof CallerInput,
  'kind' | 'hookStillActive' | 'scriptReason' | 'workspaceMode'
>;
const kindTextFields: Record<CallerInput['kind'], Array<[TextInputKey, string]>> = {
  hook: [
    ['hookName', 'Hook raw name'],
    ['hookReason', 'Hook reason'],
  ],
  script: [['scriptName', 'Script name']],
  pr: [
    ['repo', 'PR repository'],
    ['prNumber', 'PR number'],
    ['url', 'PR URL (empty uses canonical fallback)'],
  ],
};
type CallbackName = 'ontoggle' | 'onPinnedActivate' | 'onOpenLink';
type ParentPhase = 'click-capture' | 'click-bubble' | 'pointer-capture' | 'pointer-bubble';
type NativeObservation = {
  objectId: number;
  type: string;
  isTrusted: boolean;
  defaultPrevented: boolean;
  cancelBubble: boolean;
  detail: number;
  button: number;
  targetTag: string | null;
  targetTestId: string | null;
};
type CallbackObservation = {
  name: CallbackName;
  callbackRevision: number;
  mountRevision: number;
  argumentCount: number;
  arguments: unknown[];
  capturedClick: NativeObservation | null;
};
const emptyObservations = {
  counts: { ontoggle: 0, onPinnedActivate: 0, onOpenLink: 0 },
  parentCounts: {
    'click-capture': 0,
    'click-bubble': 0,
    'pointer-capture': 0,
    'pointer-bubble': 0,
  },
  callbacks: [] as CallbackObservation[],
  parent: [] as Array<NativeObservation & { phase: ParentPhase }>,
};

function ChoiceField<T extends string>({
  label,
  name,
  value,
  options,
  onChange,
}: {
  label: string;
  name: string;
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
          value={value}
          className="min-w-0 flex-wrap justify-start"
          data-testid={`wake-${name}`}
          onValueChange={(next) => {
            const selected = options.find((option) => option === next);
            if (selected) onChange(selected);
          }}
        >
          {options.map((option) => (
            <ToggleGroupItem key={option} value={option} data-testid={`wake-${name}-${option}`}>
              {option}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}
    />
  );
}

function BooleanField({
  label,
  name,
  value,
  onChange,
}: {
  label: string;
  name: string;
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
          data-testid={`wake-${name}`}
          checked={value}
          onCheckedChange={onChange}
        />
      )}
    />
  );
}

export function AutomatedWakeExamples() {
  const [draft, setDraft] = useState(initialInput);
  const [applied, setApplied] = useState(initialInput);
  const [inputRevision, setInputRevision] = useState(0);
  const [inputError, setInputError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [mounted, setMounted] = useState(true);
  const [mountRevision, setMountRevision] = useState(0);
  const [toggleRevision, setToggleRevision] = useState(0);
  const [pinnedRevision, setPinnedRevision] = useState(0);
  const [linkRevision, setLinkRevision] = useState(0);
  const [width, setWidth] = useState('320');
  const [observations, setObservations] = useState(emptyObservations);
  const capturedClick = useRef<MouseEvent | null>(null);
  const eventIds = useRef({ ids: new WeakMap<Event, number>(), next: 0 });

  const snapshotNative = useCallback((event: MouseEvent): NativeObservation => {
    let objectId = eventIds.current.ids.get(event);
    if (objectId === undefined) {
      objectId = ++eventIds.current.next;
      eventIds.current.ids.set(event, objectId);
    }
    const target = event.target instanceof Element ? event.target : null;
    return {
      objectId,
      type: event.type,
      isTrusted: event.isTrusted,
      defaultPrevented: event.defaultPrevented,
      cancelBubble: event.cancelBubble,
      detail: event.detail,
      button: event.button,
      targetTag: target?.tagName ?? null,
      targetTestId: target?.closest('[data-testid]')?.getAttribute('data-testid') ?? null,
    };
  }, []);

  const recordCallback = useCallback(
    (name: CallbackName, callbackRevision: number, args: unknown[]) => {
      // The source chevron forwards its React click event despite the zero-argument
      // callback type. Snapshot it now, while currentTarget is still available.
      const argumentsSnapshot = args.map((argument) => {
        if (argument && typeof argument === 'object' && 'nativeEvent' in argument) {
          const event = argument as ReactMouseEvent<HTMLButtonElement>;
          return {
            type: 'react-mouse-event',
            nativeEvent: snapshotNative(event.nativeEvent),
            sameAsCapturedClick: event.nativeEvent === capturedClick.current,
            currentTargetTestId: event.currentTarget.getAttribute('data-testid'),
            defaultPrevented: event.defaultPrevented,
            propagationStopped: event.isPropagationStopped(),
          };
        }
        return argument;
      });
      const observation: CallbackObservation = {
        name,
        callbackRevision,
        mountRevision,
        argumentCount: args.length,
        arguments: argumentsSnapshot,
        capturedClick: capturedClick.current ? snapshotNative(capturedClick.current) : null,
      };
      setObservations((current) => ({
        ...current,
        counts: { ...current.counts, [name]: current.counts[name] + 1 },
        callbacks: [...current.callbacks.slice(-11), observation],
      }));
    },
    [mountRevision, snapshotNative],
  );
  const ontoggle = useMemo(
    () =>
      (...args: unknown[]) =>
        recordCallback('ontoggle', toggleRevision, args),
    [toggleRevision, recordCallback],
  );
  const onPinnedActivate = useMemo(
    () =>
      (...args: unknown[]) =>
        recordCallback('onPinnedActivate', pinnedRevision, args),
    [pinnedRevision, recordCallback],
  );
  const onOpenLink = useMemo<AutomatedWakeCardHeaderProps['onOpenLink']>(
    () =>
      (...args) =>
        recordCallback('onOpenLink', linkRevision, args),
    [linkRevision, recordCallback],
  );

  const metadata: NonNullable<AgentMessage['metadata']> =
    applied.kind === 'hook'
      ? {
          type: 'hook_wake',
          hookId: 'catalog-hook',
          hookName: applied.hookName,
          reason: applied.hookReason,
          ...(applied.hookStillActive === 'undefined'
            ? {}
            : { hookStillActive: applied.hookStillActive === 'true' }),
        }
      : applied.kind === 'script'
        ? {
            type: 'script_monitor_wake',
            source: 'system',
            scriptName: applied.scriptName,
            scriptId: 'catalog-script',
            runId: 'catalog-run',
            monitorId: 'catalog-monitor',
            workspaceId: 'catalog-script-workspace',
            reason: applied.scriptReason,
          }
        : {
            type: 'pr_monitor_wake',
            monitorId: 'catalog-pr-monitor',
            repo: applied.repo,
            prNumber: Number(applied.prNumber),
            reason: 'changed',
            ...(applied.url ? { url: applied.url } : {}),
          };
  // Canonical parsing owns names, state and invalid-attribution rejection.
  const presentation = getAutomatedWakePresentation({
    id: 'catalog-wake',
    role: 'user',
    timestamp: '2026-10-12T00:00:00.000Z',
    contentBlocks: [{ type: 'text', text: 'Caller-controlled disclosure content.' }],
    metadata,
  });
  const workspace: Workspace | null | undefined =
    applied.workspaceMode === 'present'
      ? {
          id: WorkspaceId(applied.workspaceId),
          title: 'Catalog workspace',
          branch: 'catalog',
          changesets: [],
          timeline: [],
          conversationInfo: [],
          status: WorkspaceStatus.Active,
          createdAt: '2026-10-12T00:00:00.000Z',
          updatedAt: '2026-10-12T00:00:00.000Z',
          repositoryOwner: applied.repositoryOwner,
          repositoryName: applied.repositoryName,
        }
      : applied.workspaceMode === 'null'
        ? null
        : undefined;

  function change<K extends keyof CallerInput>(key: K, value: CallerInput[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }
  function apply() {
    if (
      draft.kind === 'pr' &&
      (!draft.repo.trim() ||
        !Number.isSafeInteger(Number(draft.prNumber)) ||
        Number(draft.prNumber) <= 0)
    ) {
      setInputError('Enter a repository and a positive whole PR number.');
      return;
    }
    if (!draft.controlsId.trim() || /\s/.test(draft.controlsId)) {
      setInputError('Enter a controls ID without whitespace.');
      return;
    }
    setInputError('');
    setApplied({ ...draft });
    setInputRevision((value) => value + 1);
  }
  function observeParent(phase: ParentPhase, event: ReactMouseEvent<HTMLDivElement>) {
    if (phase === 'click-capture') {
      const nativeEvent = event.nativeEvent;
      capturedClick.current = nativeEvent;
      queueMicrotask(() => {
        if (capturedClick.current === nativeEvent) capturedClick.current = null;
      });
    }
    const observation = { phase, ...snapshotNative(event.nativeEvent) };
    setObservations((current) => ({
      ...current,
      parentCounts: { ...current.parentCounts, [phase]: current.parentCounts[phase] + 1 },
      parent: [...current.parent.slice(-11), observation],
    }));
  }
  const textFields: Array<[TextInputKey, string]> = [
    ...kindTextFields[draft.kind],
    ['workspaceId', 'Workspace ID'],
    ['repositoryOwner', 'Workspace repository owner'],
    ['repositoryName', 'Workspace repository name'],
    ['controlsId', 'Disclosure controls ID'],
  ];

  return (
    <section
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4"
      data-functional-example="automated-wake"
      data-testid="automated-wake-exercise"
      aria-label="Automated wake header exercise"
    >
      <h2>Automated wake header</h2>
      <p className="type-caption text-muted-foreground">
        Internal, unreleased component exercise. Apply local metadata through the canonical
        presentation helper. Callbacks only record observations; external navigation is unverified.
        The expanded switch controls disclosure state independently of toggle callbacks.
      </p>
      <ChoiceField
        label="Wake kind"
        name="kind"
        value={draft.kind}
        options={['hook', 'script', 'pr']}
        onChange={(value) => change('kind', value)}
      />
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        {textFields.map(([key, label]) => (
          <FormField
            key={key}
            label={label}
            control={(field) => (
              <Input
                {...field}
                data-testid={`wake-${key}`}
                value={draft[key]}
                maxLength={512}
                onChange={(event) => change(key, event.target.value)}
              />
            )}
          />
        ))}
      </div>
      {draft.kind === 'hook' && (
        <ChoiceField
          label="Hook still active"
          name="hook-active"
          value={draft.hookStillActive}
          options={['true', 'false', 'undefined']}
          onChange={(value) => change('hookStillActive', value)}
        />
      )}
      {draft.kind === 'script' && (
        <ChoiceField
          label="Script reason"
          name="script-reason"
          value={draft.scriptReason}
          options={['finished', 'ttl-expired', 'output-match', 'line-count', 'unknown']}
          onChange={(value) => change('scriptReason', value)}
        />
      )}
      <ChoiceField
        label="Workspace prop"
        name="workspace-mode"
        value={draft.workspaceMode}
        options={['present', 'null', 'undefined']}
        onChange={(value) => change('workspaceMode', value)}
      />
      <div>
        <Button data-testid="wake-apply" onClick={apply}>
          Apply wake inputs
        </Button>
      </div>
      {inputError && (
        <p role="alert" className="wrap-anywhere" data-testid="wake-input-error">
          {inputError}
        </p>
      )}
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <BooleanField
          label="Controlled expanded"
          name="expanded"
          value={expanded}
          onChange={setExpanded}
        />
        <BooleanField
          label="Pinned callback enabled"
          name="pinned"
          value={pinned}
          onChange={setPinned}
        />
        <BooleanField label="Header mounted" name="mounted" value={mounted} onChange={setMounted} />
        <ChoiceField
          label="Header width"
          name="width"
          value={width}
          options={['180', '320', '640']}
          onChange={setWidth}
        />
      </div>
      <div className="flex min-w-0 flex-wrap gap-2">
        <Button
          data-testid="wake-replace-toggle"
          onClick={() => setToggleRevision((value) => value + 1)}
        >
          Replace toggle callback
        </Button>
        <Button
          data-testid="wake-replace-pinned"
          onClick={() => setPinnedRevision((value) => value + 1)}
        >
          Replace pinned callback
        </Button>
        <Button
          data-testid="wake-replace-link"
          onClick={() => setLinkRevision((value) => value + 1)}
        >
          Replace link callback
        </Button>
        <Button
          data-testid="wake-remount"
          disabled={!mounted}
          onClick={() => setMountRevision((value) => value + 1)}
        >
          Remount header
        </Button>
        <Button
          data-testid="wake-clear"
          onClick={() => {
            capturedClick.current = null;
            setObservations(emptyObservations);
          }}
        >
          Clear wake observations
        </Button>
      </div>
      <div
        role="presentation"
        className="min-w-0 max-w-full"
        style={{ width: Number(width) }}
        data-testid="automated-wake-frame"
        onClickCapture={(event) => observeParent('click-capture', event)}
        onClick={(event) => observeParent('click-bubble', event)}
        onPointerDownCapture={(event) => observeParent('pointer-capture', event)}
        onPointerDown={(event) => observeParent('pointer-bubble', event)}
      >
        {mounted && presentation && (
          <AutomatedWakeCardHeader
            key={mountRevision}
            presentation={presentation}
            expanded={expanded}
            controlsId={applied.controlsId}
            workspace={workspace}
            ontoggle={ontoggle}
            onPinnedActivate={pinned ? onPinnedActivate : undefined}
            onOpenLink={onOpenLink}
          />
        )}
      </div>
      {mounted && !presentation && (
        <output data-testid="wake-invalid-presentation" className="wrap-anywhere">
          The canonical presentation helper rejected this attribution; no header is mounted.
        </output>
      )}
      <div
        id={applied.controlsId}
        hidden={!mounted || !presentation || !expanded}
        data-testid="automated-wake-body"
        className="min-w-0 wrap-anywhere"
      >
        {presentation?.bodyText}
      </div>
      <pre
        className="min-w-0 whitespace-pre-wrap wrap-anywhere"
        data-testid="automated-wake-state"
        aria-label="Automated wake caller state"
      >
        {JSON.stringify(
          {
            applied,
            inputRevision,
            presentation,
            workspace,
            expanded,
            pinned,
            mounted,
            mountRevision,
            toggleRevision,
            pinnedRevision,
            linkRevision,
            width,
            ...observations,
          },
          (_key, value: unknown) => (value === undefined ? { type: 'undefined' } : value),
          2,
        )}
      </pre>
    </section>
  );
}
