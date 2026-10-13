// i18n-ignore (internal unreleased component preview)
import { useState } from 'react';
import { BrowserDeviceFrame } from '@/components/browser/browser-device-frame';
import { BrowserViewportMenu } from '@/components/browser/browser-viewport-menu';
import { BrowserElementPickerButton } from '@/components/browser/browser-element-picker-button';
import { BrowserOverflowMenu } from '@/components/browser/browser-overflow-menu';
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
  const [selecting, setSelecting] = useState(false);
  const [pickerToggles, setPickerToggles] = useState(0);
  const [commands, setCommands] = useState<string[]>([]);
  const [compact, setCompact] = useState(false);
  const record = (command: string) => setCommands((previous) => [...previous, command]);
  return (
    <section
      className="grid w-2xl min-w-0 max-w-[calc(100vw-var(--spacing)*12)] gap-6"
      data-testid="browser-device-frame-demo"
      data-viewport={JSON.stringify(viewport)}
      data-picker-toggles={pickerToggles}
      data-commands={JSON.stringify(commands)}
    >
      <header>
        <h1>Browser device frame</h1>
        <p className="type-caption text-muted-foreground">Internal React preview · unreleased</p>
      </header>
      <div className="flex flex-wrap gap-3">
        <BrowserViewportMenu viewport={viewport} onViewportChange={setViewport} />
        <Button
          variant="ghost"
          onClick={() => {
            setVisible(!visible);
            setSelecting(false);
          }}
        >
          {visible ? 'Hide frame' : 'Show frame'}
        </Button>
        <BrowserElementPickerButton
          active={selecting}
          disabled={!visible}
          onToggle={() => {
            setSelecting(!selecting);
            setPickerToggles((count) => count + 1);
          }}
        />
        <BrowserOverflowMenu
          collapsed={compact}
          canGoBack
          canSelectElement={visible}
          selectingElement={selecting}
          viewport={viewport}
          onViewportChange={setViewport}
          onGoBack={() => record('back')}
          onGoForward={() => record('forward')}
          onToggleElementPicker={() => {
            setSelecting(!selecting);
            setPickerToggles((count) => count + 1);
          }}
          onOpenExternal={() => record('external')}
          onCopyUrl={() => record('copy')}
          onScreenshot={() => record('screenshot')}
          onOpenConsole={() => record('console')}
          onOpenSource={() => record('source')}
          onOpenInspector={() => record('inspector')}
          onReloadWithoutCache={() => record('reload')}
        />
        <Button variant="ghost" onClick={() => setCompact(!compact)}>
          {compact ? 'Expanded toolbar' : 'Compact toolbar'}
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
    </section>
  );
}
