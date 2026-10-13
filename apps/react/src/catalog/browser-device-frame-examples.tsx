// i18n-ignore (internal unreleased component preview)
import { useState } from 'react';
import { BrowserDeviceFrame } from '@/components/browser/browser-device-frame';
import { BrowserViewportDialog } from '@/components/browser/browser-viewport-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { BrowserTabViewport } from '$shared/ipc/workspace-command-payloads';

export function BrowserDeviceFrameExamples() {
  const [viewport, setViewport] = useState<BrowserTabViewport>({
    mode: 'custom',
    width: 480,
    height: 360,
  });
  const [visible, setVisible] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [returnFocus, setReturnFocus] = useState<HTMLButtonElement | null>(null);
  return (
    <section
      className="grid w-2xl min-w-0 max-w-[calc(100vw-var(--spacing)*12)] gap-6"
      data-testid="browser-device-frame-demo"
      data-viewport={JSON.stringify(viewport)}
    >
      <header>
        <h1>Browser device frame</h1>
        <p className="type-caption text-muted-foreground">Internal React preview · unreleased</p>
      </header>
      <div className="flex flex-wrap gap-3">
        <Button
          variant="outline"
          aria-pressed={viewport.mode === 'fit'}
          onClick={() => setViewport({ mode: 'fit' })}
        >
          Fit
        </Button>
        <Button
          variant="outline"
          aria-pressed={viewport.mode === 'custom'}
          onClick={(event) => {
            setReturnFocus(event.currentTarget);
            setDialogOpen(true);
          }}
        >
          Custom
        </Button>
        <Button variant="ghost" onClick={() => setVisible(!visible)}>
          {visible ? 'Hide frame' : 'Show frame'}
        </Button>
      </div>
      <div className="h-96 min-w-0">
        {visible && (
          <BrowserDeviceFrame viewport={viewport} onViewportChange={setViewport}>
            <div className="grid content-start gap-4 p-6">
              <h2>Preview content</h2>
              <Input aria-label="Preview text" defaultValue="Keep this draft while resizing" />
            </div>
          </BrowserDeviceFrame>
        )}
      </div>
      <BrowserViewportDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        viewport={viewport}
        onViewportChange={setViewport}
        returnFocus={returnFocus}
      />
    </section>
  );
}
