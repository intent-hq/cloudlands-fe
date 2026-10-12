// i18n-ignore (internal, unreleased catalog controls and caller observations)
import { useCallback, useRef, useState } from 'react';
import { FormField, FormRow } from '@/components/patterns/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  MessageActions,
  type MessageActionsProps,
} from '@/features/chat/components/message-actions';

type Flag = 'omit' | 'true' | 'false';
type DateMode = 'omit' | 'null' | 'string' | 'number' | 'Date';
type Observation = Record<string, unknown>;
const callbackNames = [
  'onCopy',
  'onEdit',
  'onRegenerate',
  'onFork',
  'onVote',
  'onScrollToPrevious',
] as const;
type CallbackName = (typeof callbackNames)[number];

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
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
          className="min-w-0 max-w-full flex-wrap justify-start"
          onValueChange={(next) => {
            const option = options.find((entry) => entry === next);
            if (option) onChange(option);
          }}
        >
          {options.map((option) => (
            <ToggleGroupItem key={option} value={option}>
              {option}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}
    />
  );
}

function Toggle({
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

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <FormField
      label={label}
      control={(field) => (
        <Input
          {...field}
          className="min-w-0 max-w-full"
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      )}
    />
  );
}

function Output({ label, value }: { label: string; value: unknown }) {
  return (
    <output
      aria-label={label}
      className="block min-w-0 max-w-full whitespace-pre-wrap wrap-anywhere"
    >
      {JSON.stringify(
        value,
        (_key, entry) =>
          entry === undefined
            ? '[undefined]'
            : typeof entry === 'number' && !Number.isFinite(entry)
              ? String(entry)
              : entry,
        2,
      )}
    </output>
  );
}

function describeTarget(target: EventTarget | null) {
  if (target === null) return null;
  if (!(target instanceof Element)) return { constructor: target.constructor.name };
  return {
    tag: target.tagName,
    id: target.id,
    testId: target.getAttribute('data-testid'),
    ariaLabel: target.getAttribute('aria-label'),
    actionId: target.closest('[data-action-id]')?.getAttribute('data-action-id') ?? null,
  };
}

function useObservations() {
  const identities = useRef({ next: 0, objects: new WeakMap<object, number>() });
  const records = useRef({ callbacks: [] as Observation[], native: [] as Observation[] });
  const captured = useRef<Event | null>(null);
  const retained = useRef<Event[]>([]);
  const sequence = useRef(0);
  const [snapshot, setSnapshot] = useState({
    revision: 0,
    callbacks: [] as Observation[],
    native: [] as Observation[],
  });
  const eventSnapshot = useCallback((event: Event) => {
    const registry = identities.current;
    let objectId = registry.objects.get(event);
    if (objectId === undefined) {
      objectId = ++registry.next;
      registry.objects.set(event, objectId);
    }
    return {
      objectId,
      type: event.type,
      isTrusted: event.isTrusted,
      target: describeTarget(event.target),
      currentTarget: describeTarget(event.currentTarget),
      eventPhase: event.eventPhase,
      defaultPrevented: event.defaultPrevented,
      cancelBubble: event.cancelBubble,
      ...(event instanceof MouseEvent ? { button: event.button, detail: event.detail } : {}),
      ...(event instanceof KeyboardEvent
        ? { key: event.key, code: event.code, repeat: event.repeat }
        : {}),
      ...(event instanceof MouseEvent || event instanceof KeyboardEvent
        ? {
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            altKey: event.altKey,
            shiftKey: event.shiftKey,
          }
        : {}),
    };
  }, []);
  const frameRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return;
      const related = new WeakSet<Event>();
      const belongsToFrame = (event: Event) => {
        if (event.composedPath().includes(node)) return true;
        const target = event.target;
        if (!(target instanceof Node)) return false;
        return Array.from(node.querySelectorAll('[aria-controls]')).some((trigger) => {
          const id = trigger.getAttribute('aria-controls');
          return id ? document.getElementById(id)?.contains(target) : false;
        });
      };
      const releases = ([node, document] as const).flatMap((host) =>
        ['click', 'keydown', 'keyup', 'pointerenter', 'focusin'].flatMap((type) =>
          [true, false].map((capture) => {
            const listener = (event: Event) => {
              if (!related.has(event) && !belongsToFrame(event)) return;
              if (!related.has(event)) {
                related.add(event);
                captured.current = event;
                retained.current = [...retained.current.slice(-11), event];
              }
              records.current.native = [
                ...records.current.native.slice(-47),
                {
                  sequence: ++sequence.current,
                  host: host === node ? 'frame' : 'document',
                  phase: capture ? 'capture' : 'bubble',
                  ...eventSnapshot(event),
                },
              ];
            };
            host.addEventListener(type, listener, { capture, passive: true });
            return () => host.removeEventListener(type, listener, capture);
          }),
        ),
      );
      return () => {
        releases.forEach((release) => release());
        captured.current = null;
      };
    },
    [eventSnapshot],
  );
  const record = useCallback(
    (observation: Observation) => {
      const event = captured.current;
      records.current.callbacks = [
        ...records.current.callbacks.slice(-15),
        {
          sequence: ++sequence.current,
          ...observation,
          capturedEvent: event && event.eventPhase !== Event.NONE ? eventSnapshot(event) : null,
        },
      ];
    },
    [eventSnapshot],
  );
  return {
    frameRef,
    eventSnapshot,
    record,
    snapshot,
    refresh: () =>
      setSnapshot((current) => ({
        revision: current.revision + 1,
        callbacks: records.current.callbacks,
        native: [
          ...records.current.native,
          ...retained.current.map((event) => ({ phase: 'settled', ...eventSnapshot(event) })),
        ],
      })),
    clear: () => {
      records.current = { callbacks: [], native: [] };
      retained.current = [];
      captured.current = null;
      setSnapshot((current) => ({ revision: current.revision + 1, ...records.current }));
    },
  };
}

// These are direct user-selected prop types, not the component's date fallback policy.
function dateInput(mode: DateMode, value: string) {
  if (mode === 'null') return null;
  if (mode === 'number') return Number(value);
  if (mode === 'Date') return new Date(value);
  return value;
}

export function MessageActionExamples() {
  const [role, setRole] = useState<MessageActionsProps['role']>('assistant');
  const [callbacks, setCallbacks] = useState<Record<CallbackName, boolean>>({
    onCopy: true,
    onEdit: true,
    onRegenerate: true,
    onFork: true,
    onVote: true,
    onScrollToPrevious: true,
  });
  const [callbackRevision, setCallbackRevision] = useState(0);
  const [currentVote, setCurrentVote] = useState<'omit' | 'null' | 'up' | 'down'>('omit');
  const [showOnHover, setShowOnHover] = useState<Flag>('false');
  const [previousMessageLoading, setPreviousMessageLoading] = useState<Flag>('omit');
  const [supplyRequestId, setSupplyRequestId] = useState(true);
  const [requestId, setRequestId] = useState('message-session-a');
  const [timestampMode, setTimestampMode] = useState<DateMode>('string');
  const [timestamp, setTimestamp] = useState('2024-01-15T12:34:56.000Z');
  const [createdAtMode, setCreatedAtMode] = useState<DateMode>('omit');
  const [createdAt, setCreatedAt] = useState('2023-06-01T08:15:00.000Z');
  const [queueMode, setQueueMode] = useState<'omit' | 'null' | 'value'>('omit');
  const [queuedAt, setQueuedAt] = useState('2024-01-15T12:30:00.000Z');
  const [waitedMs, setWaitedMs] = useState('65000');
  const [supplyBatchId, setSupplyBatchId] = useState(false);
  const [batchId, setBatchId] = useState('message-batch-a');
  const [width, setWidth] = useState<'280' | '420' | '720' | 'full'>('420');
  const [rootMode, setRootMode] = useState<'root' | 'none'>('root');
  const [offscreen, setOffscreen] = useState(false);
  const [mounted, setMounted] = useState(true);
  const [mountRevision, setMountRevision] = useState(0);
  const [pasteText, setPasteText] = useState('');
  const [pastes, setPastes] = useState<Observation[]>([]);
  const { frameRef, eventSnapshot, record, snapshot, refresh, clear } = useObservations();

  const inputs: Omit<MessageActionsProps, CallbackName> = {
    role,
    ...(currentVote === 'omit' ? {} : { currentVote: currentVote === 'null' ? null : currentVote }),
    ...(showOnHover === 'omit' ? {} : { showOnHover: showOnHover === 'true' }),
    ...(previousMessageLoading === 'omit'
      ? {}
      : { previousMessageLoading: previousMessageLoading === 'true' }),
    ...(supplyRequestId ? { requestId } : {}),
    ...(timestampMode === 'omit' ? {} : { timestamp: dateInput(timestampMode, timestamp) }),
    ...(createdAtMode === 'omit' ? {} : { createdAt: dateInput(createdAtMode, createdAt) }),
    ...(queueMode === 'omit'
      ? {}
      : {
          queueInfo:
            queueMode === 'null'
              ? null
              : { queuedAt, waitedMs: Number(waitedMs), ...(supplyBatchId ? { batchId } : {}) },
        }),
  };
  const callbackProps: Pick<MessageActionsProps, CallbackName> = {};
  for (const name of callbackNames) {
    if (callbacks[name]) {
      callbackProps[name] = (...args: unknown[]) =>
        record({
          callback: name,
          args,
          argumentCount: args.length,
          callbackRevision,
          mountRevision,
          currentInputs: inputs,
        });
    }
  }

  return (
    <div
      data-functional-example="message-actions"
      className="grid min-w-0 max-w-full grid-cols-1 gap-4"
    >
      <p className="type-caption text-muted-foreground">
        Internal message action exercise. Callbacks only record their actual arguments. Shift-copy
        uses the component’s real clipboard; paste below to inspect the result.
      </p>
      <div className="flex min-w-0 max-w-full flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setMounted((value) => !value)}>
          {mounted ? 'Unmount actions' : 'Mount actions'}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            setMountRevision((value) => value + 1);
            setMounted(true);
          }}
        >
          Remount actions
        </Button>
        <Button variant="secondary" onClick={() => setCallbackRevision((value) => value + 1)}>
          Replace callbacks
        </Button>
        <Button variant="secondary" onClick={refresh}>
          Refresh observations
        </Button>
        <Button variant="secondary" onClick={clear}>
          Clear observations
        </Button>
      </div>
      <FormRow className="grid-cols-1">
        <Choice
          label="Message role"
          value={role}
          options={['user', 'assistant']}
          onChange={setRole}
        />
        <Choice
          label="Frame width"
          value={width}
          options={['280', '420', '720', 'full']}
          onChange={setWidth}
        />
        <Choice
          label="Controls root"
          value={rootMode}
          options={['root', 'none']}
          onChange={setRootMode}
        />
        <Toggle label="Place actions below viewport" value={offscreen} onChange={setOffscreen} />
      </FormRow>
      <div
        ref={frameRef}
        data-testid="message-actions-frame"
        className="min-w-0 max-w-full"
        style={{ width: width === 'full' ? '100%' : Number(width) }}
      >
        <ScrollArea
          className="h-64 min-w-0 max-w-full"
          fadeEdges={false}
          viewportProps={{
            ...{ 'data-testid': 'message-actions-viewport' },
            ...(rootMode === 'root' ? { 'data-message-controls-root': '' } : {}),
            'aria-label': 'Message actions scroll viewport',
          }}
        >
          {offscreen && <div aria-hidden="true" className="h-96" />}
          <div
            data-testid="message-actions-parent"
            className="group relative grid min-w-0 max-w-full grid-cols-1 gap-3 py-3"
          >
            <Button variant="ghost">Focus message</Button>
            {mounted && (
              <MessageActions key={`${rootMode}:${mountRevision}`} {...inputs} {...callbackProps} />
            )}
          </div>
          {offscreen && <div aria-hidden="true" className="h-96" />}
        </ScrollArea>
      </div>
      <FormRow className="grid-cols-1">
        {callbackNames.map((name) => (
          <Toggle
            key={name}
            label={`Supply ${name}`}
            value={callbacks[name]}
            onChange={(value) => setCallbacks((current) => ({ ...current, [name]: value }))}
          />
        ))}
        <Choice
          label="Current vote"
          value={currentVote}
          options={['omit', 'null', 'up', 'down']}
          onChange={setCurrentVote}
        />
        <Choice
          label="Show on hover"
          value={showOnHover}
          options={['omit', 'true', 'false']}
          onChange={setShowOnHover}
        />
        <Choice
          label="Previous message loading"
          value={previousMessageLoading}
          options={['omit', 'true', 'false']}
          onChange={setPreviousMessageLoading}
        />
        <Toggle label="Supply requestId" value={supplyRequestId} onChange={setSupplyRequestId} />
        <TextField label="Request ID" value={requestId} onChange={setRequestId} />
        <Choice
          label="Timestamp type"
          value={timestampMode}
          options={['omit', 'null', 'string', 'number', 'Date']}
          onChange={setTimestampMode}
        />
        <TextField label="Timestamp value" value={timestamp} onChange={setTimestamp} />
        <Choice
          label="Created at type"
          value={createdAtMode}
          options={['omit', 'null', 'string', 'number', 'Date']}
          onChange={setCreatedAtMode}
        />
        <TextField label="Created at value" value={createdAt} onChange={setCreatedAt} />
        <Choice
          label="Queue info"
          value={queueMode}
          options={['omit', 'null', 'value']}
          onChange={setQueueMode}
        />
        <TextField label="Queued at" value={queuedAt} onChange={setQueuedAt} />
        <TextField label="Waited milliseconds" value={waitedMs} onChange={setWaitedMs} />
        <Toggle label="Supply batchId" value={supplyBatchId} onChange={setSupplyBatchId} />
        <TextField label="Batch ID" value={batchId} onChange={setBatchId} />
      </FormRow>
      <FormField
        label="Paste copied session ID"
        control={(field) => (
          <Textarea
            {...field}
            data-testid="message-actions-paste"
            className="min-w-0 max-w-full"
            value={pasteText}
            onChange={(event) => setPasteText(event.currentTarget.value)}
            onPaste={(event) => {
              const native = event.nativeEvent;
              const receipt = {
                ...eventSnapshot(native),
                types: Array.from(native.clipboardData?.types ?? []),
                text: native.clipboardData?.getData('text/plain') ?? null,
              };
              setPastes((current) => [...current.slice(-3), receipt]);
            }}
          />
        )}
      />
      <Output
        label="Message action inputs"
        value={{
          mounted,
          mountRevision,
          callbackRevision,
          callbacks,
          rootMode,
          width,
          offscreen,
          timestampMode,
          createdAtMode,
          inputs,
        }}
      />
      <Output label="Message action observations" value={snapshot} />
      <Output label="Message action paste observations" value={pastes} />
    </div>
  );
}
