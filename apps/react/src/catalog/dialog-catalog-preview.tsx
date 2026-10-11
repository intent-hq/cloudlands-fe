// Port of the dialog branch in OverlayCatalogPreview.svelte.
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import type { UiComponentFixture } from '$lib/components/ui/component-metadata';

export function DialogCatalogPreview({
  fixture,
}: {
  componentId: string;
  fixture: UiComponentFixture;
}) {
  const uid = useId();
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | HTMLAnchorElement>(null);
  useLayoutEffect(() => {
    if (fixture.id !== 'dialog-open-state') return;
    const frame = requestAnimationFrame(() => {
      trigger.current?.focus();
      setDialogOpen(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [fixture.id]);
  return (
    <div className="flex flex-wrap gap-3" data-catalog-renderer-fixture={fixture.id}>
      <div ref={setContainer} id={`${uid}-portal`} data-catalog-portal-target="dialog" />
      {fixture.id === 'dialog-open-state' ? (
        <div data-catalog-rendered-state={fixture.states.join(' ')}>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button ref={trigger} variant="outline" size="sm">
                Open-state dialog trigger
              </Button>
            </DialogTrigger>
            <DialogContent container={container}>
              <DialogHeader>
                <DialogTitle>Catalog dialog open state</DialogTitle>
                <DialogDescription>
                  Deterministic open-state preview with focus restoration.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-3">
                <Input aria-label="Open-state dialog field" />
                <Button>Dialog nested action</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      ) : (
        <>
          <div data-catalog-rendered-state="closed open focused nested-content long-content">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  Open catalog dialog
                </Button>
              </DialogTrigger>
              <DialogContent container={container}>
                <DialogHeader>
                  <DialogTitle>Catalog dialog</DialogTitle>
                  <DialogDescription>
                    Host-independent dialog preview with deliberately long content for compact
                    layouts.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-3">
                  <Input size="compact" aria-label="Dialog preview field" />
                  <Button size="compact">Dialog nested action</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
          <div data-catalog-rendered-state="disabled-close">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  Open dialog with disabled close
                </Button>
              </DialogTrigger>
              <DialogContent container={container} closeDisabled>
                <DialogTitle>Disabled close dialog</DialogTitle>
                <DialogDescription>Escape and outside dismissal remain testable.</DialogDescription>
              </DialogContent>
            </Dialog>
          </div>
        </>
      )}
    </div>
  );
}
