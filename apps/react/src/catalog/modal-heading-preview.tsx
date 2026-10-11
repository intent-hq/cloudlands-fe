// Source: patterns/confirm/modal-heading-spacing.preview.svelte.
// Product-specific workspace/release/replace states remain unregistered until ported.
// i18n-ignore (reference named scene content)
import { useState } from 'react';
import { m } from '$shared/paraglide/messages.js';
import { FormDialog, DestructiveConfirm } from '@/components/patterns/confirm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogHeader,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog';

export function ModalHeadingPreview({
  kind,
}: {
  kind: 'form' | 'confirm' | 'direct' | 'wrapped' | 'stacked';
}) {
  const [open, setOpen] = useState(true);
  const [directOpen, setDirectOpen] = useState(false);
  const [accepted, setAccepted] = useState(0);
  return (
    <div className="min-h-96 p-4">
      {kind === 'stacked' ? (
        [1, 2].map((index) => (
          <Dialog key={index} open staticPosition>
            <DialogContent>
              <DialogTitle>Static dialog {index}</DialogTitle>
              <DialogDescription>Inline dialog fixture</DialogDescription>
              <Button>Inside action</Button>
            </DialogContent>
          </Dialog>
        ))
      ) : kind === 'direct' || kind === 'wrapped' ? (
        <Dialog open={directOpen} onOpenChange={setDirectOpen}>
          <DialogTrigger>Open dialog</DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {kind === 'wrapped'
                  ? 'A longer dialog heading that wraps onto multiple lines in a narrow window'
                  : 'Canonical dialog'}
              </DialogTitle>
              <DialogDescription>Dialog behavior fixture</DialogDescription>
            </DialogHeader>
            <Input aria-label="Dialog field" />
            <Button variant="ghost">Nested dialog action</Button>
            <DialogFooter>
              <Button variant="destructive" onClick={() => setAccepted((count) => count + 1)}>
                Delete item
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : (
        <>
          <Button onClick={() => setOpen(true)}>Open fixture</Button>
          {kind === 'form' ? (
            <FormDialog
              open={open}
              onOpenChange={setOpen}
              title="Edit fixture"
              description="A shared form dialog."
              onSubmit={() => {
                setAccepted((count) => count + 1);
                setOpen(false);
              }}
            >
              <Input aria-label="Fixture name" />
            </FormDialog>
          ) : (
            <DestructiveConfirm
              open={open}
              onOpenChange={setOpen}
              title={m.settings_gitWorkspace_worktreesLocation_confirm_title()}
              description={m.settings_gitWorkspace_worktreesLocation_confirm_message()}
              confirmLabel="Confirm"
              destructive={false}
              onConfirm={() => {
                setAccepted((count) => count + 1);
                setOpen(false);
              }}
            />
          )}
        </>
      )}
      <output aria-label="Accepted count">{accepted}</output>
    </div>
  );
}
