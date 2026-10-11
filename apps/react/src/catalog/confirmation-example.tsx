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
    </section>
  );
}
