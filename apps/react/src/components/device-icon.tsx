import {
  AlienIcon,
  CatIcon,
  CloudIcon,
  CoffeeIcon,
  DesktopIcon,
  DogIcon,
  GameControllerIcon,
  GhostIcon,
  HardDrivesIcon,
  LaptopIcon,
  PlanetIcon,
  PottedPlantIcon,
  RobotIcon,
  RocketIcon,
} from '@phosphor-icons/react';
import type { DeviceKind } from '$shared/types/connections';
import { resolveDeviceKind, type DeviceIconSource } from '$lib/utils/device-icon-resolver';
import { cn } from '@/lib/utils';
import { MacMiniIcon } from '@/components/icons/mac-mini-icon';
import { MacStudioIcon } from '@/components/icons/mac-studio-icon';

const deviceIcons = {
  macMini: MacMiniIcon,
  macStudio: MacStudioIcon,
  laptop: LaptopIcon,
  desktop: DesktopIcon,
  server: HardDrivesIcon,
  cloudVm: CloudIcon,
  robot: RobotIcon,
  rocket: RocketIcon,
  flyingSaucer: AlienIcon,
  ghost: GhostIcon,
  cat: CatIcon,
  dog: DogIcon,
  gameController: GameControllerIcon,
  coffee: CoffeeIcon,
  planet: PlanetIcon,
  pottedPlant: PottedPlantIcon,
} satisfies Record<DeviceKind, typeof LaptopIcon | typeof MacMiniIcon>;

export interface DeviceIconProps {
  record: DeviceIconSource;
  size?: number | string;
  className?: string;
  /** Accessible name for standalone use; omit when adjacent text already labels the icon. */
  label?: string;
}

export function DeviceIcon({ record, size = 16, className = '', label }: DeviceIconProps) {
  const Icon = deviceIcons[resolveDeviceKind(record)];
  return (
    <Icon
      size={size}
      className={cn('shrink-0', className)}
      role={label === undefined ? undefined : 'img'}
      aria-label={label}
      aria-hidden={label === undefined ? 'true' : undefined}
    />
  );
}
