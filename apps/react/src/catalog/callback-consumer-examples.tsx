// Callback-only exercises: no settings service, MCP transport or agent mutation is substituted.
// i18n-ignore (internal catalog exercise controls, not product copy)
import { useEffect, useRef, useState } from 'react';
import { AutoSaveTextarea } from '@/components/settings/auto-save-textarea';
import { McpJsonImport } from '@/components/settings/mcp/mcp-json-import';
import { ReplaceAgentModal } from '@/components/modals/replace-agent-modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';

// These promises are the real caller callbacks consumed by the production views.
// Manual settlement makes pending/rejection observable without a timer or fake service.
function useCallbackExercise() {
  const [hold, setHold] = useState(false);
  const [status, setStatus] = useState('idle');
  const [attempts, setAttempts] = useState(0);
  const [received, setReceived] = useState('');
  const [completed, setCompleted] = useState('');
  const pending = useRef(new Set<{ resolve: () => void; reject: (error: Error) => void }>());
  useEffect(() => {
    const callbacks = pending.current;
    return () => {
      for (const callback of callbacks) callback.resolve();
      callbacks.clear();
    };
  }, []);

  async function run(value: string) {
    setAttempts((count) => count + 1);
    setReceived(value);
    setStatus('pending');
    try {
      if (hold) {
        await new Promise<void>((resolve, reject) => {
          pending.current.add({ resolve, reject });
        });
      } else {
        await Promise.resolve();
      }
      setCompleted(value);
      setStatus('completed');
    } catch (error) {
      setStatus('rejected');
      throw error;
    }
  }

  function settle(reject: boolean) {
    for (const callback of pending.current) {
      if (reject) callback.reject(new Error('Caller rejected this callback'));
      else callback.resolve();
    }
    pending.current.clear();
  }

  return { hold, setHold, status, attempts, received, completed, run, settle };
}

function CallbackControls({
  name,
  callback,
}: {
  name: string;
  callback: ReturnType<typeof useCallbackExercise>;
}) {
  return (
    <>
      <Switch
        aria-label={`Hold ${name} callback`}
        checked={callback.hold}
        onCheckedChange={callback.setHold}
      />
      <div className="flex flex-wrap gap-2">
        <Button disabled={callback.status !== 'pending'} onClick={() => callback.settle(false)}>
          Resolve {name} callback
        </Button>
        <Button disabled={callback.status !== 'pending'} onClick={() => callback.settle(true)}>
          Reject {name} callback
        </Button>
      </div>
      <output aria-label={`${name} callback status`}>{callback.status}</output>
      <output aria-label={`${name} callback attempts`}>{callback.attempts}</output>
      <output aria-label={`${name} callback received`}>{callback.received}</output>
      <output aria-label={`${name} callback completed`}>{callback.completed}</output>
    </>
  );
}

export function TextareaConsumerExample() {
  const save = useCallbackExercise();
  const imported = useCallbackExercise();
  const [value, setValue] = useState('Original prompt');
  const [cancelled, setCancelled] = useState(0);
  return (
    <section className="grid gap-4" data-functional-example="textarea-consumers">
      <p className="type-caption text-muted-foreground">
        Callback-only exercise. These callbacks record local results; backend persistence is not
        exercised.
      </p>
      <h2>Autosave textarea callback</h2>
      <CallbackControls name="Autosave" callback={save} />
      <div data-testid="callback-autosave-setting">
        <AutoSaveTextarea
          value={value}
          originalValue={value}
          minRows={3}
          maxLength={80}
          onSave={async (next) => {
            await save.run(next);
            setValue(next);
          }}
        />
      </div>
      <Button variant="outline" onClick={() => setValue('External prompt')}>
        Apply external prompt
      </Button>
      <output aria-label="Autosave current value">{value}</output>
      <h2>MCP JSON import callback</h2>
      <CallbackControls name="Import" callback={imported} />
      <div data-testid="callback-json-import-setting">
        <McpJsonImport
          onImport={imported.run}
          onCancel={() => setCancelled((count) => count + 1)}
        />
      </div>
      <output aria-label="Import cancelled count">{cancelled}</output>
    </section>
  );
}

export function ReplaceAgentExample() {
  const [open, setOpen] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [agentName, setAgentName] = useState('Fixture agent');
  const [specialist, setSpecialist] = useState('implementor');
  const [sent, setSent] = useState('');
  const [sends, setSends] = useState(0);
  const [cancelled, setCancelled] = useState(0);
  return (
    <section className="grid gap-4" data-functional-example="replace-agent-callback">
      <p className="type-caption text-muted-foreground">
        Callback-only exercise. The dialog's synchronous onSend records the exact instruction here;
        it does not send chat or replace an agent.
      </p>
      <h2>Replace agent callback</h2>
      <Input
        aria-label="Replacement agent name"
        value={agentName}
        onChange={(event) => setAgentName(event.currentTarget.value)}
      />
      <Input
        aria-label="Replacement specialist"
        value={specialist}
        onChange={(event) => setSpecialist(event.currentTarget.value)}
      />
      <Button
        onClick={() => {
          setGeneration((current) => current + 1);
          setOpen(true);
        }}
      >
        Open replace agent
      </Button>
      <ReplaceAgentModal
        key={generation}
        open={open}
        onOpenChange={setOpen}
        agentName={agentName}
        specialist={specialist || null}
        onSend={(text) => {
          setSent(text);
          setSends((count) => count + 1);
        }}
        onCancel={() => setCancelled((count) => count + 1)}
      />
      <output aria-label="Replacement dialog open">{String(open)}</output>
      <output aria-label="Replacement sent instruction">{sent}</output>
      <output aria-label="Replacement send count">{sends}</output>
      <output aria-label="Replacement cancelled count">{cancelled}</output>
    </section>
  );
}
