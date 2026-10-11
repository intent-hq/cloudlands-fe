// Interactive production confirmation flows. These are separate from appearance fixtures.
// i18n-ignore (deterministic internal catalog example content)
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ConfirmHost,
  FormDialog,
  DestructiveConfirm,
  confirm,
  prompt,
  alert,
} from '@/components/patterns/confirm';

export function ConfirmationExample() {
  const [formOpen, setFormOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [name, setName] = useState('Workspace');
  const [savedName, setSavedName] = useState('Workspace');
  const [accepted, setAccepted] = useState(0);
  const [cancelled, setCancelled] = useState(0);
  const [result, setResult] = useState('none');
  const [queueResults, setQueueResults] = useState<string[]>([]);
  const [retryAttempts, setRetryAttempts] = useState(0);
  const [retryResult, setRetryResult] = useState('none');
  return (
    <section
      className="grid gap-4"
      data-functional-example="confirmation-flow"
      aria-label="Confirmation example"
    >
      <h2>Confirmation flows</h2>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setFormOpen(true)}>Edit workspace</Button>
        <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
          Remove workspace
        </Button>
        <Button
          variant="outline"
          onClick={async () =>
            setResult(
              String(
                await confirm({
                  title: 'Archive workspace',
                  description: 'Keep the workspace available in the archive.',
                  confirmLabel: 'Archive',
                  cancelLabel: 'Cancel',
                }),
              ),
            )
          }
        >
          Confirm archive
        </Button>
        <Button
          variant="outline"
          onClick={async () =>
            setResult(
              JSON.stringify(
                await prompt({
                  title: 'Rename workspace',
                  confirmLabel: 'Rename',
                  cancelLabel: 'Cancel',
                  field: { label: 'Workspace name', initialValue: savedName, required: true },
                }),
              ),
            )
          }
        >
          Prompt for name
        </Button>
        <Button
          variant="outline"
          onClick={async () => {
            await alert({
              title: 'Workspace saved',
              description: 'Your local example changes have been saved.',
              confirmLabel: 'Got it',
            });
            setResult('acknowledged');
          }}
        >
          Show acknowledgement
        </Button>
        <Button
          variant="outline"
          onClick={async () => {
            setQueueResults([]);
            // Both invocations enqueue immediately, before either promise settles.
            const first = confirm({
              title: 'Queued confirmation 1',
              confirmLabel: 'Accept first',
              cancelLabel: 'Cancel first',
            });
            const second = confirm({
              title: 'Queued confirmation 2',
              confirmLabel: 'Accept second',
              cancelLabel: 'Cancel second',
            });
            await Promise.all([
              first.then((value) => setQueueResults((current) => [...current, `first:${value}`])),
              second.then((value) => setQueueResults((current) => [...current, `second:${value}`])),
            ]);
          }}
        >
          Queue confirmations
        </Button>
        <Button
          variant="outline"
          onClick={async () => {
            let attempts = 0;
            setRetryAttempts(0);
            setRetryResult('pending');
            const accepted = await confirm({
              title: 'Confirmation retry example',
              description: 'The first callback rejects. Accept again to retry.',
              confirmLabel: 'Accept retry example',
              cancelLabel: 'Cancel retry example',
              onConfirm: async () => {
                attempts += 1;
                setRetryAttempts(attempts);
                await Promise.resolve();
                if (attempts === 1) throw new Error('Example confirmation rejected');
              },
            });
            setRetryResult(String(accepted));
          }}
        >
          Confirm with retry
        </Button>
      </div>
      <FormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        title="Edit workspace"
        description="Update the local example name."
        submitLabel="Save workspace"
        canSubmit={name.trim().length > 0}
        onCancel={() => setCancelled((count) => count + 1)}
        onSubmit={() => {
          setSavedName(name.trim());
          setAccepted((count) => count + 1);
          setFormOpen(false);
        }}
      >
        <Input
          aria-label="Workspace draft name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
      </FormDialog>
      <DestructiveConfirm
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Remove workspace"
        description="This removes the local example workspace."
        confirmLabel="Remove"
        onCancel={() => setCancelled((count) => count + 1)}
        onConfirm={() => {
          setSavedName('');
          setAccepted((count) => count + 1);
          setDeleteOpen(false);
        }}
      />
      <ConfirmHost />
      <output aria-label="Confirmation accepted count">{accepted}</output>
      <output aria-label="Confirmation cancelled count">{cancelled}</output>
      <output aria-label="Confirmed workspace name">{savedName}</output>
      <output aria-label="Confirmation service result">{result}</output>
      <output aria-label="Confirmation queue results">{JSON.stringify(queueResults)}</output>
      <output aria-label="Confirmation retry attempts">{retryAttempts}</output>
      <output aria-label="Confirmation retry result">{retryResult}</output>
    </section>
  );
}
