// i18n-ignore (internal catalog caller inputs and observations, not released product copy)
import { useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { FormField } from '@/components/patterns/form';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Toast } from '@/components/ui/toast';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ChatCliBlock } from '@/features/chat/components/chat-cli-block';
import { QueuedMessageActions } from '@/features/chat/components/queued-message-actions';

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
  controls: ReactNode;
  inputs: unknown;
  observations: unknown;
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
      <div className="min-h-8 w-full min-w-0 max-w-[420px]" data-testid={`${id}-frame`}>
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
        {JSON.stringify({ mounted, revision, inputs, observations }, null, 2)}
      </pre>
    </section>
  );
}

type ActionObservation = {
  action: 'edit' | 'sendNow' | 'remove';
  revision: number;
  argumentCount: number;
  event: {
    type: string;
    detail: number;
    isTrusted: boolean;
    currentTargetLabel: string | null;
  } | null;
};
type ParentObservation = { label: string | null; trusted: boolean; detail: number };

function observeParentEvent(event: MouseEvent<HTMLDivElement>): ParentObservation {
  const target = event.target instanceof Element ? event.target.closest('button') : null;
  return {
    label: target?.getAttribute('aria-label') ?? null,
    trusted: event.isTrusted,
    detail: event.detail,
  };
}

function QueuedActionsExercise() {
  const [permissions, setPermissions] = useState({ edit: true, sendNow: true, remove: true });
  const [editDisabled, setEditDisabled] = useState(false);
  const [sendDisabled, setSendDisabled] = useState(false);
  const [removeDisabled, setRemoveDisabled] = useState(false);
  const [sending, setSending] = useState(false);
  const [includeSendCallback, setIncludeSendCallback] = useState(true);
  const [callbackRevision, setCallbackRevision] = useState(0);
  const [callbacks, setCallbacks] = useState<ActionObservation[]>([]);
  const [parentClicks, setParentClicks] = useState<ParentObservation[]>([]);
  const [parentPointerDowns, setParentPointerDowns] = useState<ParentObservation[]>([]);
  const handlers = useMemo(() => {
    const record = (
      action: ActionObservation['action'],
      args: [event?: MouseEvent<HTMLButtonElement>],
    ) => {
      const event = args[0];
      const observation: ActionObservation = {
        action,
        revision: callbackRevision,
        argumentCount: args.length,
        event: event
          ? {
              type: event.type,
              detail: event.detail,
              isTrusted: event.isTrusted,
              currentTargetLabel: event.currentTarget.getAttribute('aria-label'),
            }
          : null,
      };
      setCallbacks((current) => [...current, observation]);
    };
    return {
      onedit: (...args: [event?: MouseEvent<HTMLButtonElement>]) => record('edit', args),
      onsendnow: (...args: [event?: MouseEvent<HTMLButtonElement>]) => record('sendNow', args),
      onremove: (...args: [event?: MouseEvent<HTMLButtonElement>]) => record('remove', args),
    };
  }, [callbackRevision]);
  const inputs = {
    permissions,
    editDisabled,
    sendDisabled,
    removeDisabled,
    sending,
    includeSendCallback,
    callbackRevision,
  };
  return (
    <Exercise
      id="command-queued-actions"
      name="Queued actions"
      inputs={inputs}
      observations={{ callbacks, parentClicks, parentPointerDowns }}
      controls={
        <>
          <div className="flex min-w-0 flex-wrap gap-3">
            {(
              [
                ['edit', 'Allow edit'],
                ['sendNow', 'Allow send now'],
                ['remove', 'Allow remove'],
              ] as const
            ).map(([permission, label]) => (
              <BooleanField
                key={permission}
                label={label}
                value={permissions[permission]}
                onChange={(value) =>
                  setPermissions((current) => ({ ...current, [permission]: value }))
                }
              />
            ))}
          </div>
          <div className="flex min-w-0 flex-wrap gap-3">
            <BooleanField label="Disable edit" value={editDisabled} onChange={setEditDisabled} />
            <BooleanField
              label="Disable send now"
              value={sendDisabled}
              onChange={setSendDisabled}
            />
            <BooleanField
              label="Disable remove"
              value={removeDisabled}
              onChange={setRemoveDisabled}
            />
            <BooleanField label="Sending" value={sending} onChange={setSending} />
            <BooleanField
              label="Include send callback"
              value={includeSendCallback}
              onChange={setIncludeSendCallback}
            />
          </div>
          <div className="flex min-w-0 flex-wrap gap-3">
            <Button onClick={() => setCallbackRevision((current) => current + 1)}>
              Replace callbacks
            </Button>
            <Button
              onClick={() => {
                setCallbacks([]);
                setParentClicks([]);
                setParentPointerDowns([]);
              }}
            >
              Clear observations
            </Button>
          </div>
        </>
      }
    >
      <div
        role="presentation"
        className="grid min-w-0 gap-3 py-2"
        data-testid="command-queued-parent"
        onClick={(event) => {
          const observation = observeParentEvent(event);
          setParentClicks((current) => [...current, observation]);
        }}
        onPointerDown={(event) => {
          const observation = observeParentEvent(event);
          setParentPointerDowns((current) => [...current, observation]);
        }}
      >
        <p className="type-caption text-muted-foreground">Parent observation area</p>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <QueuedMessageActions
            permissions={permissions}
            editDisabled={editDisabled}
            sendDisabled={sendDisabled}
            removeDisabled={removeDisabled}
            sending={sending}
            onedit={handlers.onedit}
            onsendnow={includeSendCallback ? handlers.onsendnow : undefined}
            onremove={handlers.onremove}
          />
        </div>
      </div>
    </Exercise>
  );
}

const commandPresets = {
  current: 'pnpm run check',
  empty: '',
  long: `pnpm exec playwright test ${'src/features/chat/components/very-long-command-path/'.repeat(8)}command-card.ct.spec.ts`,
  multiline: 'git status --short\npnpm run check\npnpm run lint:design-cheatsheet',
};
type CommandPreset = keyof typeof commandPresets;

function CommandCardExercise() {
  const [preset, setPreset] = useState<CommandPreset>('current');
  const [command, setCommand] = useState(commandPresets.current);
  const [pastedText, setPastedText] = useState('');
  return (
    <Exercise
      id="command-cli"
      name="Command card"
      inputs={{ command, preset }}
      observations={{ pastedText }}
      controls={
        <>
          <FormField
            label="Command preset"
            control={(field) => (
              <ToggleGroup
                id={field.id}
                type="single"
                aria-label="Command preset"
                className="min-w-0 flex-wrap justify-start"
                value={preset}
                onValueChange={(next) => {
                  if (!Object.hasOwn(commandPresets, next)) return;
                  setPreset(next as CommandPreset);
                  setCommand(commandPresets[next as CommandPreset]);
                }}
              >
                {Object.keys(commandPresets).map((choice) => (
                  <ToggleGroupItem key={choice} value={choice}>
                    {choice}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            )}
          />
          <FormField
            label="Command"
            control={(field) => (
              <Textarea
                {...field}
                value={command}
                onChange={(event) => {
                  setPreset('current');
                  setCommand(event.target.value);
                }}
              />
            )}
          />
          <FormField
            label="Paste copied command"
            control={(field) => (
              <Textarea
                {...field}
                value={pastedText}
                onChange={(event) => setPastedText(event.target.value)}
              />
            )}
          />
        </>
      }
    >
      <ChatCliBlock command={command} />
    </Exercise>
  );
}

export function ChatCommandExamples() {
  return (
    <section
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-8"
      aria-label="Chat command examples"
      data-functional-example="chat-command"
    >
      <p className="type-caption text-muted-foreground" data-internal-example>
        Internal migration exercise. Native behavior, visual parity, and product integration remain
        unverified.
      </p>
      <QueuedActionsExercise />
      <CommandCardExercise />
      <Toast />
    </section>
  );
}
