import type { Component } from 'svelte';
import type { DeviceKind } from '$shared/types/connections';
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
} from '$lib/icons/phosphor-icons';
import MacMiniIcon from '$lib/icons/MacMiniIcon.svelte';
import MacStudioIcon from '$lib/icons/MacStudioIcon.svelte';
import { DEVICE_ICON_METADATA, type DeviceIconMetadata } from './device-icon-options';

export { resolveDeviceKind, type DeviceIconSource } from './device-icon-resolver';
export { deviceIconOptions, type DeviceIconOption } from './device-icon-options';

type DeviceIconComponent = Component<Record<string, unknown>>;

export interface DeviceIconDefinition extends DeviceIconMetadata {
  icon: DeviceIconComponent;
}

function withMetadata<Kind extends DeviceKind, Icon extends DeviceIconComponent>(
  kind: Kind,
  icon: Icon,
): {
  icon: Icon;
  group: (typeof DEVICE_ICON_METADATA)[Kind]['group'];
  readonly label: (typeof DEVICE_ICON_METADATA)[Kind]['label'];
} {
  return {
    icon,
    group: DEVICE_ICON_METADATA[kind].group,
    get label() {
      return DEVICE_ICON_METADATA[kind].label;
    },
  };
}

export const DEVICE_ICON_REGISTRY = {
  macMini: withMetadata('macMini', MacMiniIcon),
  macStudio: withMetadata('macStudio', MacStudioIcon),
  laptop: withMetadata('laptop', LaptopIcon),
  desktop: withMetadata('desktop', DesktopIcon),
  server: withMetadata('server', HardDrivesIcon),
  cloudVm: withMetadata('cloudVm', CloudIcon),
  robot: withMetadata('robot', RobotIcon),
  rocket: withMetadata('rocket', RocketIcon),
  // Phosphor has no flying-saucer glyph in the installed version; Alien is the closest playful match.
  flyingSaucer: withMetadata('flyingSaucer', AlienIcon),
  ghost: withMetadata('ghost', GhostIcon),
  cat: withMetadata('cat', CatIcon),
  dog: withMetadata('dog', DogIcon),
  gameController: withMetadata('gameController', GameControllerIcon),
  coffee: withMetadata('coffee', CoffeeIcon),
  planet: withMetadata('planet', PlanetIcon),
  pottedPlant: withMetadata('pottedPlant', PottedPlantIcon),
} satisfies Record<DeviceKind, DeviceIconDefinition>;
