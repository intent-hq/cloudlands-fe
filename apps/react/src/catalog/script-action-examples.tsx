// i18n-ignore (internal, unreleased catalog controls and caller observations)
import { useState } from 'react';
import { FormField } from '@/components/patterns/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  SetupScriptCard,
  type SetupScriptCardProps,
} from '@/features/chat/components/setup-script-card';
import {
  EditRegenerateConfirmDialog,
  type EditRegenerateConfirmDialogProps,
} from '@/features/chat/components/edit-regenerate-confirm-dialog';

type Observation = Record<string, unknown>;

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <FormField
      label={label}
      control={(field) => (
        <Switch {...field} ariaLabel={label} checked={checked} onCheckedChange={onChange} />
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
      {JSON.stringify(value, null, 2)}
    </output>
  );
}

function ScriptCardExercise() {
  const [name, setName] = useState('Prepare workspace');
  const [description, setDescription] = useState('Install dependencies for this workspace.');
  const [content, setContent] = useState('# Workspace setup\npnpm install\n');
  const [supplyUseScript, setSupplyUseScript] = useState(true);
  const [callbackRevision, setCallbackRevision] = useState(0);
  const [mounted, setMounted] = useState(true);
  const [mountRevision, setMountRevision] = useState(0);
  const [width, setWidth] = useState('420');
  const [uses, setUses] = useState({ count: 0, records: [] as Observation[] });
  const [pasteText, setPasteText] = useState('');
  const [pastes, setPastes] = useState({ count: 0, records: [] as Observation[] });
  const inputs = { name, description, content };
  const onUseScript: NonNullable<SetupScriptCardProps['onUseScript']> = (...args) => {
    const receipt = { args, argumentCount: args.length, callbackRevision, mountRevision, inputs };
    setUses((current) => ({
      count: current.count + 1,
      records: [...current.records.slice(-11), receipt],
    }));
  };

  return (
    <section
      aria-label="Setup script exercise"
      className="grid min-w-0 max-w-full grid-cols-1 gap-3"
    >
      <h2>Setup script</h2>
      <FormField
        label="Script name"
        control={(field) => (
          <Input {...field} value={name} onChange={(event) => setName(event.currentTarget.value)} />
        )}
      />
      <FormField
        label="Script description"
        control={(field) => (
          <Input
            {...field}
            value={description}
            onChange={(event) => setDescription(event.currentTarget.value)}
          />
        )}
      />
      <FormField
        label="Script content"
        control={(field) => (
          <Textarea
            {...field}
            className="min-w-0 max-w-full"
            rows={5}
            value={content}
            onChange={(event) => setContent(event.currentTarget.value)}
          />
        )}
      />
      <Toggle label="Supply onUseScript" checked={supplyUseScript} onChange={setSupplyUseScript} />
      <Toggle label="Script mounted" checked={mounted} onChange={setMounted} />
      <div className="flex min-w-0 max-w-full flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setCallbackRevision((value) => value + 1)}>
          Replace script callback
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            setMountRevision((value) => value + 1);
            setMounted(true);
          }}
        >
          Remount script
        </Button>
      </div>
      <FormField
        label="Script frame width"
        control={(field) => (
          <ToggleGroup
            {...field}
            type="single"
            aria-label="Script frame width"
            className="min-w-0 max-w-full flex-wrap justify-start"
            value={width}
            onValueChange={(value) => {
              if (value === '420' || value === '720') setWidth(value);
            }}
          >
            <ToggleGroupItem value="420">420</ToggleGroupItem>
            <ToggleGroupItem value="720">720</ToggleGroupItem>
          </ToggleGroup>
        )}
      />
      <div
        data-testid="script-card-frame"
        className="min-w-0 max-w-full"
        style={{ width: Number(width) }}
      >
        {mounted && (
          <SetupScriptCard
            key={mountRevision}
            {...inputs}
            {...(supplyUseScript ? { onUseScript } : {})}
          />
        )}
      </div>
      <FormField
        label="Paste copied script"
        description="Use the native paste shortcut after copying from the card."
        control={(field) => (
          <Textarea
            {...field}
            data-testid="script-paste"
            className="min-w-0 max-w-full"
            value={pasteText}
            onChange={(event) => setPasteText(event.currentTarget.value)}
            onPaste={(event) => {
              const native = event.nativeEvent;
              const receipt = {
                type: native.type,
                isTrusted: native.isTrusted,
                types: Array.from(native.clipboardData?.types ?? []),
                text: native.clipboardData?.getData('text/plain') ?? null,
              };
              setPastes((current) => ({
                count: current.count + 1,
                records: [...current.records.slice(-3), receipt],
              }));
            }}
          />
        )}
      />
      <Output
        label="Script inputs"
        value={{ ...inputs, supplyUseScript, callbackRevision, mounted, mountRevision, width }}
      />
      <Output label="Script callback observations" value={uses} />
      <Output label="Script paste observations" value={pastes} />
    </section>
  );
}

function EditConfirmationExercise() {
  const [open, setOpen] = useState(false);
  const [supplyOpen, setSupplyOpen] = useState(true);
  const [supplyConfirm, setSupplyConfirm] = useState(true);
  const [supplyCancel, setSupplyCancel] = useState(true);
  const [closeParent, setCloseParent] = useState(true);
  const [callbackRevision, setCallbackRevision] = useState(0);
  const [mounted, setMounted] = useState(true);
  const [mountRevision, setMountRevision] = useState(0);
  const [observations, setObservations] = useState({
    confirmCount: 0,
    cancelCount: 0,
    records: [] as Observation[],
  });

  function record(callback: 'onConfirm' | 'onCancel', args: unknown[]) {
    const receipt = {
      callback,
      args,
      argumentCount: args.length,
      callbackRevision,
      mountRevision,
      parentOpen: open,
      closeParent,
    };
    setObservations((current) => ({
      confirmCount: current.confirmCount + (callback === 'onConfirm' ? 1 : 0),
      cancelCount: current.cancelCount + (callback === 'onCancel' ? 1 : 0),
      records: [...current.records.slice(-11), receipt],
    }));
    if (closeParent) setOpen(false);
  }

  const onConfirm: NonNullable<EditRegenerateConfirmDialogProps['onConfirm']> = (...args) =>
    record('onConfirm', args);
  const onCancel: NonNullable<EditRegenerateConfirmDialogProps['onCancel']> = (...args) =>
    record('onCancel', args);

  return (
    <section
      aria-label="Edit confirmation exercise"
      className="grid min-w-0 max-w-full grid-cols-1 gap-3"
    >
      <h2>Edit confirmation</h2>
      <Toggle label="Supply open" checked={supplyOpen} onChange={setSupplyOpen} />
      <Toggle label="Supply onConfirm" checked={supplyConfirm} onChange={setSupplyConfirm} />
      <Toggle label="Supply onCancel" checked={supplyCancel} onChange={setSupplyCancel} />
      <Toggle label="Close parent after callback" checked={closeParent} onChange={setCloseParent} />
      <Toggle label="Edit confirmation mounted" checked={mounted} onChange={setMounted} />
      <div className="flex min-w-0 max-w-full flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setCallbackRevision((value) => value + 1)}>
          Replace edit callbacks
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            setMountRevision((value) => value + 1);
            setMounted(true);
          }}
        >
          Remount edit confirmation
        </Button>
        <Button variant="secondary" onClick={() => setOpen(false)}>
          Reset parent open
        </Button>
        <Button
          data-testid="edit-confirmation-open"
          disabled={!mounted}
          onClick={() => setOpen(true)}
        >
          Open edit confirmation
        </Button>
      </div>
      {mounted && (
        <EditRegenerateConfirmDialog
          key={mountRevision}
          {...(supplyOpen ? { open } : {})}
          {...(supplyConfirm ? { onConfirm } : {})}
          {...(supplyCancel ? { onCancel } : {})}
        />
      )}
      <Output
        label="Edit confirmation inputs"
        value={{
          open,
          supplyOpen,
          supplyConfirm,
          supplyCancel,
          closeParent,
          callbackRevision,
          mounted,
          mountRevision,
        }}
      />
      <Output label="Edit confirmation observations" value={observations} />
    </section>
  );
}

export function ScriptActionExamples() {
  return (
    <div
      data-functional-example="script-actions"
      className="grid min-w-0 max-w-full grid-cols-1 gap-6"
    >
      <p className="type-caption text-muted-foreground">
        Internal, unreleased component exercise. Script and edit callbacks record their received
        arguments only; copying uses the real clipboard. No script is run and no transcript is
        changed. Native behavior and source appearance remain unverified.
      </p>
      <ScriptCardExercise />
      <EditConfirmationExercise />
    </div>
  );
}
