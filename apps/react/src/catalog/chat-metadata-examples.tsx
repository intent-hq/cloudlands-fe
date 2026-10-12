// i18n-ignore (internal catalog caller inputs and observations, not released product copy)
import { useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import { FormField } from '@/components/patterns/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { AutoUnarchivedNotice } from '@/features/chat/components/auto-unarchived-notice';
import { ChatDraftLoadingGate } from '@/features/chat/components/chat-draft-loading-gate';
import { DiscussionRequestNotice } from '@/features/chat/components/discussion-request-notice';
import { HookWakeAttributionHeader } from '@/features/chat/components/hook-wake-attribution-header';
import { LiveStreamPhaseIndicator } from '@/features/chat/components/live-stream-phase-indicator';
import { QueuedMessageNoticeHeader } from '@/features/chat/components/queued-message-notice-header';
import { TurnFailureNotice } from '@/features/chat/components/turn-failure-notice';
import { usePresence } from '@/lib/motion';
import { cn } from '@/lib/utils';
import type { HookWakeAttribution } from '$lib/utils/hook-wake-attribution';
import type { QueueInfo } from '$lib/utils/queue-info';
import type { FailureRecord } from '../../../../src/features/agent/utils/failure-summary';

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

function TextField({
  label,
  value,
  onChange,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
}) {
  return (
    <FormField
      label={label}
      control={(field) =>
        multiline ? (
          <Textarea {...field} value={value} onChange={(event) => onChange(event.target.value)} />
        ) : (
          <Input {...field} value={value} onChange={(event) => onChange(event.target.value)} />
        )
      }
    />
  );
}

function ChoiceField<K extends string>({
  label,
  choices,
  value,
  onChange,
}: {
  label: string;
  choices: readonly K[];
  value: K;
  onChange: (value: K) => void;
}) {
  return (
    <FormField
      label={label}
      control={(field) => (
        <ToggleGroup
          id={field.id}
          type="single"
          aria-label={label}
          className="min-w-0 flex-wrap justify-start"
          value={value}
          onValueChange={(next) => {
            if (choices.includes(next as K)) onChange(next as K);
          }}
        >
          {choices.map((choice) => (
            <ToggleGroupItem key={choice} value={choice}>
              {choice}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}
    />
  );
}

function Exercise({
  id,
  name,
  controls,
  inputs,
  observations,
  children,
}: {
  id: string;
  name: string;
  controls?: ReactNode;
  inputs: unknown;
  observations?: unknown;
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
      <div className="min-h-8 min-w-0" data-testid={`${id}-frame`}>
        {mounted && (
          <div key={revision} className="min-w-0" data-testid={`${id}-leaf`}>
            {children}
          </div>
        )}
      </div>
      <pre
        className="min-w-0 whitespace-pre-wrap wrap-anywhere"
        aria-label={`${name} state`}
        data-testid={`${id}-state`}
      >
        {JSON.stringify(
          { mounted, revision, inputs, observations },
          (_key, value) => (value === undefined ? '[undefined]' : value),
          2,
        )}
      </pre>
    </section>
  );
}

const phaseChoices = [
  'omitted',
  'null',
  'connecting',
  'awaiting-snapshot',
  'resyncing',
  'delayed',
  'live',
] as const;

function LivePhaseExercise() {
  const [phaseChoice, setPhaseChoice] = useState<(typeof phaseChoices)[number]>('omitted');
  const [turnInFlight, setTurnInFlight] = useState(false);
  const inputs: ComponentProps<typeof LiveStreamPhaseIndicator> = {
    ...(phaseChoice === 'omitted' ? {} : { phase: phaseChoice === 'null' ? null : phaseChoice }),
    turnInFlight,
  };
  return (
    <Exercise
      id="metadata-live-phase"
      name="Live stream phase"
      inputs={inputs}
      controls={
        <>
          <ChoiceField
            label="Stream phase"
            choices={phaseChoices}
            value={phaseChoice}
            onChange={setPhaseChoice}
          />
          <BooleanField label="Turn in flight" value={turnInFlight} onChange={setTurnInFlight} />
        </>
      }
    >
      <LiveStreamPhaseIndicator {...inputs} />
    </Exercise>
  );
}

function DiscussionPresence({
  present,
  reason,
  onExit,
}: {
  present: boolean;
  reason: string | undefined;
  onExit: () => void;
}) {
  const items = useMemo(() => (present ? ['discussion'] : []), [present]);
  const { entries, remove } = usePresence(items, (item) => item);
  return entries.map((entry) => (
    <DiscussionRequestNotice
      key={entry.key}
      reason={reason}
      present={entry.present}
      onExit={() => {
        onExit();
        remove(entry.key);
      }}
    />
  ));
}

function DiscussionExercise() {
  const [reason, setReason] = useState(
    'Choose whether the next change should include the migration.',
  );
  const [includeReason, setIncludeReason] = useState(true);
  const [present, setPresent] = useState(true);
  const [exitCount, setExitCount] = useState(0);
  const inputs = { reason: includeReason ? reason : undefined, present };
  return (
    <Exercise
      id="metadata-discussion"
      name="Discussion request"
      inputs={inputs}
      observations={{ exitCount }}
      controls={
        <>
          <TextField label="Discussion reason" value={reason} onChange={setReason} multiline />
          <BooleanField
            label="Include discussion reason"
            value={includeReason}
            onChange={setIncludeReason}
          />
          <BooleanField label="Discussion present" value={present} onChange={setPresent} />
        </>
      }
    >
      <DiscussionPresence {...inputs} onExit={() => setExitCount((current) => current + 1)} />
    </Exercise>
  );
}

function FailureExercise() {
  const [mode, setMode] = useState<'fallback' | 'empty' | 'single' | 'multiple'>('multiple');
  const [reason, setReason] = useState('Fallback diagnostic supplied by the caller.');
  const [firstReason, setFirstReason] = useState(
    'First recorded failure.\nCheck the provider response.',
  );
  const [firstTimestamp, setFirstTimestamp] = useState('2026-10-12T03:20:00.000Z');
  const [secondReason, setSecondReason] = useState('Second recorded failure.');
  const [secondTimestamp, setSecondTimestamp] = useState('2026-10-12T03:10:00.000Z');
  const [pasted, setPasted] = useState('');
  // Ordinary readonly caller records; there is no transcript store or network fixture.
  const first: FailureRecord = {
    messageId: 'history-first',
    reason: firstReason,
    timestamp: firstTimestamp,
  };
  const second: FailureRecord = {
    messageId: 'history-second',
    reason: secondReason,
    timestamp: secondTimestamp,
  };
  const records: readonly FailureRecord[] | undefined =
    mode === 'fallback'
      ? undefined
      : mode === 'empty'
        ? []
        : mode === 'single'
          ? [first]
          : [first, second];
  const inputs = { reason, records };
  return (
    <Exercise
      id="metadata-failure"
      name="Failure history"
      inputs={inputs}
      observations={{ mode, pasted }}
      controls={
        <>
          <ChoiceField
            label="Failure records"
            choices={['fallback', 'empty', 'single', 'multiple']}
            value={mode}
            onChange={setMode}
          />
          <TextField
            label="Failure fallback reason"
            value={reason}
            onChange={setReason}
            multiline
          />
          <TextField
            label="Failure first reason"
            value={firstReason}
            onChange={setFirstReason}
            multiline
          />
          <TextField
            label="Failure first timestamp"
            value={firstTimestamp}
            onChange={setFirstTimestamp}
          />
          <TextField
            label="Failure second reason"
            value={secondReason}
            onChange={setSecondReason}
            multiline
          />
          <TextField
            label="Failure second timestamp"
            value={secondTimestamp}
            onChange={setSecondTimestamp}
          />
          <div className="flex min-w-0 flex-wrap gap-3">
            <Button
              onClick={() => setFirstReason('Diagnostic detail from the caller.\n'.repeat(40))}
            >
              Use long failure reason
            </Button>
            <Button onClick={() => setPasted('')}>Clear failure paste</Button>
          </div>
          <TextField
            label="Paste copied failure details"
            value={pasted}
            onChange={setPasted}
            multiline
          />
        </>
      }
    >
      <TurnFailureNotice {...inputs} />
    </Exercise>
  );
}

function AutoUnarchivedExercise() {
  const [title, setTitle] = useState('Workspace automatically unarchived after a new message.');
  const [includeTitle, setIncludeTitle] = useState(true);
  const inputs = { title: includeTitle ? title : undefined };
  return (
    <Exercise
      id="metadata-unarchived"
      name="Auto-unarchived notice"
      inputs={inputs}
      controls={
        <>
          <TextField label="Auto-unarchived title" value={title} onChange={setTitle} multiline />
          <BooleanField
            label="Include unarchived title"
            value={includeTitle}
            onChange={setIncludeTitle}
          />
        </>
      }
    >
      <AutoUnarchivedNotice {...inputs} />
    </Exercise>
  );
}

function QueueExercise() {
  const [waitedMs, setWaitedMs] = useState(65000);
  const [queuedAt, setQueuedAt] = useState('2026-10-12T03:00:00.000Z');
  const queueInfo: QueueInfo = { waitedMs, queuedAt };
  return (
    <Exercise
      id="metadata-queued"
      name="Queued message"
      inputs={{ queueInfo }}
      controls={
        <>
          <FormField
            label="Queue wait milliseconds"
            control={(field) => (
              <Input
                {...field}
                type="number"
                min={0}
                step={1}
                value={waitedMs}
                onChange={(event) => {
                  const next = event.target.valueAsNumber;
                  if (Number.isFinite(next)) setWaitedMs(next);
                }}
              />
            )}
          />
          <TextField label="Queued at timestamp" value={queuedAt} onChange={setQueuedAt} />
        </>
      }
    >
      <QueuedMessageNoticeHeader queueInfo={queueInfo} />
    </Exercise>
  );
}

function HookExercise() {
  const [displayName, setDisplayName] = useState('Review watcher');
  const [rawName, setRawName] = useState('');
  const [reason, setReason] = useState('dispatched');
  const [active, setActive] = useState<'absent' | 'true' | 'false'>('absent');
  const [narrow, setNarrow] = useState(false);
  const attribution: HookWakeAttribution = {
    hookId: 'caller-hook',
    displayName,
    rawName,
    reason,
    ...(active === 'absent' ? {} : { hookStillActive: active === 'true' }),
  };
  return (
    <Exercise
      id="metadata-hook"
      name="Hook wake attribution"
      inputs={{ attribution, narrow }}
      controls={
        <>
          <TextField label="Hook display name" value={displayName} onChange={setDisplayName} />
          <TextField label="Hook raw name" value={rawName} onChange={setRawName} />
          <TextField label="Hook reason" value={reason} onChange={setReason} />
          <ChoiceField
            label="Hook still active"
            choices={['absent', 'true', 'false']}
            value={active}
            onChange={setActive}
          />
          <BooleanField label="Narrow hook frame" value={narrow} onChange={setNarrow} />
          <div className="flex min-w-0 flex-wrap gap-3">
            <Button
              onClick={() => setDisplayName('Review watcher for a long workspace name '.repeat(12))}
            >
              Use long hook name
            </Button>
            <Button onClick={() => setDisplayName('Review watcher')}>Use short hook name</Button>
          </div>
        </>
      }
    >
      <div className={cn('w-full min-w-0', narrow && 'max-w-64')} data-testid="metadata-hook-width">
        <HookWakeAttributionHeader attribution={attribution} />
      </div>
    </Exercise>
  );
}

export function ChatMetadataExamples() {
  return (
    <section
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-8"
      aria-label="Chat metadata examples"
      data-functional-example="chat-metadata"
    >
      <p className="type-caption text-muted-foreground" data-internal-example>
        Internal migration exercise. Native behavior, visual parity, and product integration remain
        unverified.
      </p>
      <LivePhaseExercise />
      <DiscussionExercise />
      <Exercise id="metadata-draft" name="Draft loading gate" inputs={{}}>
        <ChatDraftLoadingGate />
      </Exercise>
      <FailureExercise />
      <AutoUnarchivedExercise />
      <QueueExercise />
      <HookExercise />
    </section>
  );
}
