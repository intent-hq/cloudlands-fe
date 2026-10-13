import {
  isDetectedDeviceKind,
  isDeviceKind,
  type DetectedDeviceKind,
  type DeviceIconChoice,
  type DeviceKind,
} from '$shared/types/connections';

export interface DeviceIconSource {
  deviceIcon?: DeviceIconChoice;
  detectedDeviceKind?: DetectedDeviceKind | null;
  os?: string | null;
}

function fallbackDeviceKind(os: string | null | undefined): DeviceKind {
  const normalized = os?.toLowerCase();
  // This covers pre-device-kind daemons and never-connected remotes, where Linux is most likely headless.
  if (normalized === 'linux') return 'server';
  return 'desktop';
}

export function resolveDeviceKind(source: DeviceIconSource): DeviceKind {
  if (isDeviceKind(source.deviceIcon)) return source.deviceIcon;
  if (isDetectedDeviceKind(source.detectedDeviceKind)) return source.detectedDeviceKind;
  return fallbackDeviceKind(source.os);
}
