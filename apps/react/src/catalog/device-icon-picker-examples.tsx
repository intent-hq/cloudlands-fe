// i18n-ignore (internal unreleased preview controls and callback observations)
import { StrictMode, useState } from 'react';
import { DeviceIconPicker } from '@/components/device-icon-picker';
import { Button } from '@/components/ui/button';
import type { DeviceIconChoice } from '$shared/types/connections';

export function DeviceIconPickerExamples() {
  const [value, setValue] = useState<DeviceIconChoice>();
  const [detected, setDetected] = useState(true);
  const [disabled, setDisabled] = useState(false);
  const [portal, setPortal] = useState(false);
  const [retire, setRetire] = useState(false);
  const [shown, setShown] = useState(true);
  const [revision, setRevision] = useState(0);
  const [events, setEvents] = useState<{ value: DeviceIconChoice; revision: number }[]>([]);
  return (
    <section data-testid="device-icon-picker-demo" className="grid min-w-0 w-full gap-4">
      <header>
        <h2>Device icon picker</h2>
        <p className="type-caption text-muted-foreground">Internal React preview · unreleased</p>
      </header>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setValue('cat')}>
          Set external cat
        </Button>
        <Button variant="outline" onClick={() => setValue(undefined)}>
          Clear external override
        </Button>
        <Button variant="outline" aria-pressed={detected} onClick={() => setDetected(!detected)}>
          Mac mini detected
        </Button>
        <Button variant="outline" aria-pressed={disabled} onClick={() => setDisabled(!disabled)}>
          Disable picker
        </Button>
        <Button variant="outline" aria-pressed={portal} onClick={() => setPortal(!portal)}>
          Use portal
        </Button>
        <Button variant="outline" aria-pressed={retire} onClick={() => setRetire(!retire)}>
          Retire on selection
        </Button>
        <Button variant="outline" onClick={() => setRevision((current) => current + 1)}>
          Update callback
        </Button>
        {!shown && (
          <Button variant="outline" onClick={() => setShown(true)}>
            Remount picker
          </Button>
        )}
      </div>
      <div data-testid="device-icon-picker-frame" className="flex min-w-0 items-center gap-3">
        {shown && (
          <StrictMode>
            <DeviceIconPicker
              record={{
                deviceIcon: 'auto',
                detectedDeviceKind: detected ? 'macMini' : null,
                os: 'linux',
              }}
              value={value}
              disabled={disabled}
              portal={portal}
              onChange={(next) => {
                setEvents((previous) => [...previous, { value: next, revision }]);
                if (retire) setShown(false);
              }}
            />
          </StrictMode>
        )}
        <Button variant="outline">After picker</Button>
      </div>
      <output aria-label="Device picker callbacks" className="min-w-0 break-words">
        {JSON.stringify(events)}
      </output>
    </section>
  );
}
