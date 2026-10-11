// Source: NavigationHelpCatalogPreview.svelte (kbd, scroll-area and tooltip branches).
// i18n-ignore (reference catalog fixture content)
import { useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ShortcutChip } from '@/components/ui/kbd';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import type { UiComponentFixture } from '$lib/components/ui/component-metadata';

function TooltipPreview({ fixture }: { fixture: UiComponentFixture }) {
  const [open, setOpen] = useState(false);
  const [portal, setPortal] = useState<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const frame = useRef(0);
  const openState = fixture.id === 'tooltip-open-state';
  useLayoutEffect(() => {
    frame.current = requestAnimationFrame(() => {
      if (openState) trigger.current?.focus();
      setOpen(true);
    });
    return () => cancelAnimationFrame(frame.current);
  }, [openState]);
  return (
    <>
      <div
        ref={setPortal}
        className="pb-10"
        data-catalog-rendered-state={
          openState ? fixture.states.join(' ') : 'open portal arrow reduced-motion'
        }
      >
        <TooltipProvider delayDuration={0}>
          <Tooltip
            open={open}
            delayDuration={0}
            onOpenChange={(next) => {
              setOpen(next);
              if (!next && !openState) {
                cancelAnimationFrame(frame.current);
                frame.current = requestAnimationFrame(() => setOpen(true));
              }
            }}
          >
            <TooltipTrigger asChild>
              <Button ref={trigger} variant="outline" size="sm">
                {openState ? 'Open-state tooltip trigger' : 'Keyboard help'}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" portalTarget={portal}>
              Press Command K to open navigation.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      {!openState && (
        <div data-catalog-rendered-state="closed hover-delay keyboard-focus escape-dismiss">
          <TooltipProvider delayDuration={300}>
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm">
                  Delayed help
                </Button>
              </TooltipTrigger>
              <TooltipContent>Focus or pause to show help.</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      )}
    </>
  );
}
export function NavigationHelpCatalogPreview({
  componentId,
  fixture,
}: {
  componentId: string;
  fixture: UiComponentFixture;
}) {
  return (
    <div
      className="grid w-full min-w-0 grid-cols-1 gap-4 overflow-hidden"
      data-catalog-renderer-fixture={fixture.id}
    >
      {componentId === 'kbd' && (
        <div
          className="flex flex-wrap items-center gap-3"
          data-catalog-rendered-state="single-key modifier key-sequence long-key light dark zoom-200"
        >
          <ShortcutChip>Esc</ShortcutChip>
          <div className="flex items-center gap-1" aria-label="Command K shortcut">
            <ShortcutChip>⌘</ShortcutChip>
            <span aria-hidden="true">+</span>
            <ShortcutChip>K</ShortcutChip>
          </div>
          <ShortcutChip>Enter</ShortcutChip>
          <ShortcutChip className="min-w-16">Page Down</ShortcutChip>
        </div>
      )}
      {componentId === 'scroll-area' && (
        <div
          className="grid gap-3"
          data-catalog-rendered-state="vertical horizontal both keyboard-focus long-content no-overflow reduced-motion"
        >
          <ScrollArea
            orientation="both"
            className="h-36 max-w-full rounded-md border border-border"
          >
            <div className="w-max space-y-2 p-3">
              {Array.from({ length: 18 }, (_, index) => (
                <p key={index}>
                  Navigation documentation row {index + 1} with deliberately long horizontal content
                </p>
              ))}
            </div>
          </ScrollArea>
          <ScrollArea orientation="vertical" className="h-16 max-w-full">
            <p>Short content does not overflow.</p>
          </ScrollArea>
        </div>
      )}
      {componentId === 'tooltip' && <TooltipPreview fixture={fixture} />}
    </div>
  );
}
