// i18n-ignore (internal unreleased preview controls and canonical device identifiers)
import { useState } from 'react';
import { DeviceIcon } from '@/components/device-icon';
import { Button } from '@/components/ui/button';
import { DEVICE_KINDS, type DeviceIconChoice } from '$shared/types/connections';

export function DeviceIconExamples() {
  const [choice, setChoice] = useState<DeviceIconChoice>('auto');
  const [detected, setDetected] = useState(true);
  return (
    <section
      className="grid w-lg min-w-0 max-w-[calc(100vw-var(--spacing)*12)] gap-6"
      data-testid="device-icons-demo"
    >
      <header>
        <h1>Device icons</h1>
        <p className="type-caption text-muted-foreground">Internal React preview · unreleased</p>
      </header>
      <div className="flex items-center gap-3">
        <DeviceIcon
          record={{
            deviceIcon: choice,
            detectedDeviceKind: detected ? 'macMini' : null,
            os: 'linux',
          }}
          size={40}
          label="Selected device"
        />
        <output aria-label="Device icon choice">{choice}</output>
      </div>
      <div className="flex flex-wrap gap-3" aria-label="Device examples">
        <Button
          variant="outline"
          aria-pressed={choice === 'auto'}
          onClick={() => setChoice('auto')}
        >
          Automatic
        </Button>
        {DEVICE_KINDS.map((kind) => (
          <Button
            key={kind}
            variant="outline"
            aria-pressed={choice === kind}
            onClick={() => setChoice(kind)}
            leadingIcon={<DeviceIcon record={{ deviceIcon: kind }} />}
          >
            {kind}
          </Button>
        ))}
      </div>
      <Button variant="ghost" aria-pressed={detected} onClick={() => setDetected(!detected)}>
        Mac Mini detected
      </Button>
    </section>
  );
}
