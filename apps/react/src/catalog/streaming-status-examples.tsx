// i18n-ignore (internal catalog caller inputs and observations, not released product copy)
import { useMemo, useState, type ComponentProps } from 'react';
import { FormField } from '@/components/patterns/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { StreamingStatus } from '@/features/chat/components/streaming-status';
import type { StatusEvent } from '$lib/components/chat/streaming-status-utils';

type StatusProps = ComponentProps<typeof StreamingStatus>;
type CallbackName =
  | 'onRetry'
  | 'onRetryWithModel'
  | 'onRetryWithProvider'
  | 'onStop'
  | 'onStalledRetry'
  | 'onOpenAgentBackendSettings';
type CallbackObservation = {
  name: CallbackName;
  callbackRevision: number;
  mountRevision: number;
  argumentCount: number;
  arguments: Array<string | null>;
};

const recoveryStates = ['automatic', 'attempting', 'queued', 'action-needed', 'inactive'] as const;
const queueReasons = ['none', 'slots', 'memory-budget'] as const;
const phases = [
  'launch',
  'prompt',
  'tool-call',
  'tool-waiting',
  'streaming',
  'stalled',
  'resumed',
] as const;
const providers = [
  { id: 'claude-code', displayName: 'Claude Code' },
  { id: 'codex', displayName: 'Codex' },
  { id: 'gemini', displayName: 'Gemini CLI' },
] as const;

// Validate editable caller data without reordering events or projecting component status.
function isStatusEvent(value: unknown): value is StatusEvent {
  if (typeof value !== 'object' || value === null) return false;
  const event = value as Record<string, unknown>;
  return (
    Object.keys(event).every((key) =>
      ['phase', 'message', 'level', 'timestamp', 'silentMs'].includes(key),
    ) &&
    typeof event.phase === 'string' &&
    event.phase.length <= 80 &&
    typeof event.message === 'string' &&
    event.message.length <= 500 &&
    (event.level === 'info' || event.level === 'warn' || event.level === 'error') &&
    typeof event.timestamp === 'number' &&
    Number.isFinite(event.timestamp) &&
    (event.silentMs === undefined ||
      (typeof event.silentMs === 'number' &&
        Number.isFinite(event.silentMs) &&
        event.silentMs >= 0))
  );
}

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

function ChoiceField<T extends string>({
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
          aria-label={label}
          className="min-w-0 flex-wrap justify-start"
          type="single"
          value={value}
          onValueChange={(next) => {
            const selected = options.find((option) => option === next);
            if (selected) onChange(selected);
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

export function StreamingStatusExamples() {
  const [isStreaming, setStreaming] = useState(false);
  const [isProcessing, setProcessing] = useState(true);
  const [recovery, setRecovery] = useState<(typeof recoveryStates)[number]>('automatic');
  const [hasPendingPermission, setPendingPermission] = useState(false);
  const [queueReason, setQueueReason] = useState<(typeof queueReasons)[number]>('none');
  const [queueWaiting, setQueueWaiting] = useState(true);
  const [phase, setPhase] = useState<(typeof phases)[number]>('launch');
  const [eventMessage, setEventMessage] = useState('Launching the provider process…');
  const [statusEvents, setStatusEvents] = useState<StatusEvent[]>([]);
  const [eventsDraft, setEventsDraft] = useState('[]');
  const [eventsError, setEventsError] = useState('');
  const [eventRevision, setEventRevision] = useState(0);
  const [lastChunkTime, setLastChunkTime] = useState<number | null>(null);
  const [chunkDraft, setChunkDraft] = useState('');
  const [chunkError, setChunkError] = useState('');
  const [receivedFirstChunk, setReceivedFirstChunk] = useState(false);
  const [streamingContentLength, setContentLength] = useState(0);
  const [errorEnabled, setErrorEnabled] = useState(false);
  const [error, setError] = useState('The response stream ended before the agent finished.');
  const [sessionCorrupted, setSessionCorrupted] = useState(false);
  const [failedAt, setFailedAt] = useState<string | null>(null);
  const [failureDraft, setFailureDraft] = useState('');
  const [authEnabled, setAuthEnabled] = useState(false);
  const [loginCommandHint, setLoginCommandHint] = useState('claude auth login');
  const [showClaudeDesktopNote, setClaudeDesktopNote] = useState(true);
  const [pastedCommand, setPastedCommand] = useState('');
  const [modelEnabled, setModelEnabled] = useState(false);
  const [failedModel, setFailedModel] = useState('preview:primary-model');
  const [nextAvailableModel, setNextAvailableModel] = useState('preview:fallback-model');
  const [quotaEnabled, setQuotaEnabled] = useState(false);
  const [quotaProvider, setQuotaProvider] =
    useState<(typeof providers)[number]['id']>('claude-code');
  const [includeProviderName, setIncludeProviderName] = useState(true);
  const [alternatives, setAlternatives] = useState<string[]>(['codex', 'gemini']);
  const [includeCallbacks, setIncludeCallbacks] = useState(true);
  const [callbackRevision, setCallbackRevision] = useState(0);
  const [mounted, setMounted] = useState(true);
  const [mountRevision, setMountRevision] = useState(0);
  const [observations, setObservations] = useState<{
    count: number;
    callbacks: CallbackObservation[];
  }>({
    count: 0,
    callbacks: [],
  });

  const handlers = useMemo(() => {
    const record = (name: CallbackName, args: unknown[]) => {
      setObservations((current) => ({
        count: current.count + 1,
        callbacks: [
          ...current.callbacks.slice(-11),
          {
            name,
            callbackRevision,
            mountRevision,
            argumentCount: args.length,
            arguments: args.map((argument) => (typeof argument === 'string' ? argument : null)),
          },
        ],
      }));
    };
    return {
      onRetry: (...args: unknown[]) => record('onRetry', args),
      onRetryWithModel: (...args: unknown[]) => record('onRetryWithModel', args),
      onRetryWithProvider: (...args: unknown[]) => record('onRetryWithProvider', args),
      onStop: (...args: unknown[]) => record('onStop', args),
      onStalledRetry: (...args: unknown[]) => record('onStalledRetry', args),
      onOpenAgentBackendSettings: (...args: unknown[]) =>
        record('onOpenAgentBackendSettings', args),
    };
  }, [callbackRevision, mountRevision]);

  // These are ordinary caller inputs. The leaf owns every status/visibility decision.
  const inputs = {
    isStreaming,
    isProcessing,
    recoveryState: recovery === 'automatic' ? undefined : recovery,
    hasPendingPermission,
    processQueueHint:
      queueReason === 'none'
        ? undefined
        : { waiting: queueWaiting, used: 3, cap: 3, reason: queueReason },
    statusEvents,
    lastChunkTime,
    receivedFirstChunk,
    streamingContentLength,
    error: errorEnabled ? error : null,
    sessionCorrupted,
    failedAt,
    authGuidance: authEnabled ? { loginCommandHint, showClaudeDesktopNote } : null,
    modelUnavailable: modelEnabled ? { failedModel, nextAvailableModel } : null,
    quotaExceeded: quotaEnabled
      ? {
          providerId: quotaProvider,
          displayName: includeProviderName
            ? providers.find((provider) => provider.id === quotaProvider)?.displayName
            : undefined,
        }
      : null,
    quotaRetryProviders: providers.filter(
      (provider) => provider.id !== quotaProvider && alternatives.includes(provider.id),
    ),
  } satisfies Omit<StatusProps, 'onOpenAgentBackendSettings'>;

  return (
    <section
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4"
      data-testid="streaming-status-exercise"
      data-functional-example="streaming-status"
      aria-label="Streaming status exercise"
    >
      <h2>Streaming status and recovery</h2>
      <p className="type-caption text-muted-foreground">
        Internal, unreleased component exercise. Controls supply local props; retry, stop and
        settings actions only record callbacks. Login commands copy to the clipboard without being
        executed.
      </p>
      <div className="flex min-w-0 flex-wrap items-end gap-3">
        <BooleanField label="Streaming active" value={isStreaming} onChange={setStreaming} />
        <BooleanField label="Processing active" value={isProcessing} onChange={setProcessing} />
        <BooleanField
          label="Permission pending"
          value={hasPendingPermission}
          onChange={setPendingPermission}
        />
      </div>
      <ChoiceField
        label="Recovery state"
        value={recovery}
        options={recoveryStates}
        onChange={setRecovery}
      />
      <ChoiceField
        label="Admission wait"
        value={queueReason}
        options={queueReasons}
        onChange={setQueueReason}
      />
      <BooleanField label="Queue waiting" value={queueWaiting} onChange={setQueueWaiting} />
      <ChoiceField label="Status event phase" value={phase} options={phases} onChange={setPhase} />
      <FormField
        label="Status event message"
        control={(field) => (
          <Input
            {...field}
            value={eventMessage}
            maxLength={500}
            onChange={(event) => setEventMessage(event.target.value)}
          />
        )}
      />
      <div className="flex min-w-0 flex-wrap gap-3">
        <Button
          onClick={() => {
            const event: StatusEvent = {
              phase,
              message: eventMessage,
              level: phase === 'stalled' ? 'warn' : 'info',
              timestamp: Date.now(),
            };
            const next = [...statusEvents.slice(-11), event];
            setStatusEvents(next);
            setEventsDraft(JSON.stringify(next, null, 2));
            setEventsError('');
            setEventRevision((current) => current + 1);
          }}
        >
          Emit status event
        </Button>
        <Button
          onClick={() => {
            const timestamp = Date.now();
            setLastChunkTime(timestamp);
            setChunkDraft(String(timestamp));
            setChunkError('');
            setReceivedFirstChunk(true);
            setContentLength((current) => current + 1);
          }}
        >
          Receive new chunk
        </Button>
        <Button
          onClick={() => {
            setStatusEvents([]);
            setEventsDraft('[]');
            setEventsError('');
            setLastChunkTime(null);
            setChunkDraft('');
            setChunkError('');
            setReceivedFirstChunk(false);
            setContentLength(0);
            setEventRevision((current) => current + 1);
          }}
        >
          Clear stream events
        </Button>
      </div>
      <FormField
        label="Status events JSON"
        description="Up to 12 events in supplied order; equal timestamps and optional silentMs are preserved."
        error={eventsError}
        control={(field) => (
          <Textarea
            {...field}
            value={eventsDraft}
            maxLength={16000}
            onChange={(event) => setEventsDraft(event.target.value)}
          />
        )}
      />
      <Button
        onClick={() => {
          try {
            const events: unknown = JSON.parse(eventsDraft);
            if (!Array.isArray(events) || events.length > 12 || !events.every(isStatusEvent)) {
              setEventsError(
                'Use up to 12 events with phase, message, level, finite timestamp and optional nonnegative silentMs.',
              );
              return;
            }
            setStatusEvents(events);
            setEventsError('');
            setEventRevision((current) => current + 1);
          } catch {
            setEventsError('Enter a valid JSON array of status events.');
          }
        }}
      >
        Apply status events
      </Button>
      <FormField
        label="Last chunk timestamp"
        description="A timestamp in milliseconds; empty clears it."
        error={chunkError}
        control={(field) => (
          <Input
            {...field}
            value={chunkDraft}
            maxLength={30}
            onChange={(event) => setChunkDraft(event.target.value)}
          />
        )}
      />
      <Button
        onClick={() => {
          const timestamp = chunkDraft.trim() === '' ? null : Number(chunkDraft);
          if (timestamp !== null && !Number.isFinite(timestamp)) {
            setChunkError('Enter a finite timestamp in milliseconds, or leave empty.');
            return;
          }
          setLastChunkTime(timestamp);
          setChunkError('');
        }}
      >
        Apply last chunk timestamp
      </Button>
      <div className="flex min-w-0 flex-wrap items-end gap-3">
        <BooleanField label="Include error" value={errorEnabled} onChange={setErrorEnabled} />
        <BooleanField
          label="Session corrupted"
          value={sessionCorrupted}
          onChange={setSessionCorrupted}
        />
        <BooleanField label="Include auth guidance" value={authEnabled} onChange={setAuthEnabled} />
        <BooleanField
          label="Claude desktop note"
          value={showClaudeDesktopNote}
          onChange={setClaudeDesktopNote}
        />
      </div>
      <FormField
        label="Failure details"
        control={(field) => (
          <Textarea
            {...field}
            value={error}
            maxLength={4000}
            onChange={(event) => setError(event.target.value)}
          />
        )}
      />
      <div className="flex min-w-0 flex-wrap gap-3">
        <Button
          onClick={() => {
            const timestamp = new Date().toISOString();
            setFailedAt(timestamp);
            setFailureDraft(timestamp);
          }}
        >
          Mark failure now
        </Button>
        <Button
          onClick={() => {
            setFailedAt(null);
            setFailureDraft('');
          }}
        >
          Clear failure timestamp
        </Button>
      </div>
      <FormField
        label="Failure timestamp"
        description="Passes the entered string unchanged, including invalid dates; empty clears it."
        control={(field) => (
          <Input
            {...field}
            value={failureDraft}
            maxLength={120}
            onChange={(event) => setFailureDraft(event.target.value)}
          />
        )}
      />
      <Button onClick={() => setFailedAt(failureDraft || null)}>Apply failure timestamp</Button>
      <FormField
        label="Login command"
        control={(field) => (
          <Input
            {...field}
            value={loginCommandHint}
            maxLength={300}
            onChange={(event) => setLoginCommandHint(event.target.value)}
          />
        )}
      />
      <FormField
        label="Paste copied login command"
        control={(field) => (
          <Input
            {...field}
            value={pastedCommand}
            maxLength={300}
            onChange={(event) => setPastedCommand(event.target.value)}
          />
        )}
      />
      <BooleanField label="Model unavailable" value={modelEnabled} onChange={setModelEnabled} />
      <FormField
        label="Failed model"
        control={(field) => (
          <Input
            {...field}
            value={failedModel}
            maxLength={180}
            onChange={(event) => setFailedModel(event.target.value)}
          />
        )}
      />
      <FormField
        label="Next available model"
        control={(field) => (
          <Input
            {...field}
            value={nextAvailableModel}
            maxLength={180}
            onChange={(event) => setNextAvailableModel(event.target.value)}
          />
        )}
      />
      <div className="flex min-w-0 flex-wrap items-end gap-3">
        <BooleanField label="Quota exceeded" value={quotaEnabled} onChange={setQuotaEnabled} />
        <BooleanField
          label="Include provider display name"
          value={includeProviderName}
          onChange={setIncludeProviderName}
        />
      </div>
      <ChoiceField
        label="Exhausted provider"
        value={quotaProvider}
        options={providers.map((provider) => provider.id)}
        onChange={setQuotaProvider}
      />
      <div className="flex min-w-0 flex-wrap items-end gap-3">
        {providers.map((provider) => (
          <BooleanField
            key={provider.id}
            label={`Offer ${provider.displayName} retry`}
            value={alternatives.includes(provider.id)}
            onChange={(enabled) => {
              setAlternatives((current) =>
                enabled ? [...current, provider.id] : current.filter((id) => id !== provider.id),
              );
            }}
          />
        ))}
      </div>
      <div className="flex min-w-0 flex-wrap items-end gap-3">
        <BooleanField
          label="Include optional callbacks"
          value={includeCallbacks}
          onChange={setIncludeCallbacks}
        />
        <BooleanField label="Mount streaming status" value={mounted} onChange={setMounted} />
        <Button onClick={() => setCallbackRevision((current) => current + 1)}>
          Replace streaming callbacks
        </Button>
        <Button disabled={!mounted} onClick={() => setMountRevision((current) => current + 1)}>
          Remount streaming status
        </Button>
        <Button onClick={() => setObservations({ count: 0, callbacks: [] })}>
          Clear streaming observations
        </Button>
      </div>
      <div className="min-h-8 w-full min-w-0 max-w-[420px]" data-testid="streaming-status-frame">
        {mounted && (
          <div key={mountRevision} className="min-w-0" data-testid="streaming-status-leaf">
            <StreamingStatus
              {...inputs}
              onOpenAgentBackendSettings={handlers.onOpenAgentBackendSettings}
              onRetry={includeCallbacks ? handlers.onRetry : undefined}
              onRetryWithModel={includeCallbacks ? handlers.onRetryWithModel : undefined}
              onRetryWithProvider={includeCallbacks ? handlers.onRetryWithProvider : undefined}
              onStop={includeCallbacks ? handlers.onStop : undefined}
              onStalledRetry={includeCallbacks ? handlers.onStalledRetry : undefined}
            />
          </div>
        )}
      </div>
      <pre
        className="min-w-0 whitespace-pre-wrap wrap-anywhere"
        aria-label="Streaming status caller state"
        data-testid="streaming-status-state"
      >
        {JSON.stringify(
          {
            mounted,
            mountRevision,
            callbackRevision,
            includeCallbacks,
            eventRevision,
            inputs,
            pastedCommand,
            observations,
          },
          null,
          2,
        )}
      </pre>
    </section>
  );
}
