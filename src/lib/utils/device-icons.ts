import type { Component } from 'svelte';
import {
  DETECTED_DEVICE_KINDS,
  WILD_CARD_DEVICE_KINDS,
  isDetectedDeviceKind,
  isDeviceKind,
  type DetectedDeviceKind,
  type DeviceIconChoice,
  type DeviceKind,
} from '$shared/types/connections';
import { m } from '$shared/paraglide/messages.js';
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

export type DeviceIconGroup = 'devices' | 'wildCards';
export type DeviceIconComponent = Component<Record<string, unknown>>;

export interface DeviceIconSource {
  deviceIcon?: DeviceIconChoice;
  detectedDeviceKind?: DetectedDeviceKind | null;
  os?: string | null;
}

export interface DeviceIconDefinition {
  icon: DeviceIconComponent;
  group: DeviceIconGroup;
  readonly label: string;
}

export interface DeviceIconOption {
  value: DeviceIconChoice;
  kind: DeviceKind;
  group: DeviceIconGroup | 'automatic';
  label: string;
}

export const DEVICE_ICON_KINDS = {
  devices: DETECTED_DEVICE_KINDS,
  wildCards: WILD_CARD_DEVICE_KINDS,
} as const satisfies Record<DeviceIconGroup, readonly DeviceKind[]>;

export const DEVICE_ICON_REGISTRY = {
  macMini: {
    icon: MacMiniIcon,
    group: 'devices',
    get label() {
      return m.deviceIcons_kind_macMini_label();
    },
  },
  macStudio: {
    icon: MacStudioIcon,
    group: 'devices',
    get label() {
      return m.deviceIcons_kind_macStudio_label();
    },
  },
  laptop: {
    icon: LaptopIcon,
    group: 'devices',
    get label() {
      return m.deviceIcons_kind_laptop_label();
    },
  },
  desktop: {
    icon: DesktopIcon,
    group: 'devices',
    get label() {
      return m.deviceIcons_kind_desktop_label();
    },
  },
  server: {
    icon: HardDrivesIcon,
    group: 'devices',
    get label() {
      return m.deviceIcons_kind_server_label();
    },
  },
  cloudVm: {
    icon: CloudIcon,
    group: 'devices',
    get label() {
      return m.deviceIcons_kind_cloudVm_label();
    },
  },
  robot: {
    icon: RobotIcon,
    group: 'wildCards',
    get label() {
      return m.deviceIcons_kind_robot_label();
    },
  },
  rocket: {
    icon: RocketIcon,
    group: 'wildCards',
    get label() {
      return m.deviceIcons_kind_rocket_label();
    },
  },
  // Phosphor has no flying-saucer glyph in the installed version; Alien is the closest playful match.
  flyingSaucer: {
    icon: AlienIcon,
    group: 'wildCards',
    get label() {
      return m.deviceIcons_kind_flyingSaucer_label();
    },
  },
  ghost: {
    icon: GhostIcon,
    group: 'wildCards',
    get label() {
      return m.deviceIcons_kind_ghost_label();
    },
  },
  cat: {
    icon: CatIcon,
    group: 'wildCards',
    get label() {
      return m.deviceIcons_kind_cat_label();
    },
  },
  dog: {
    icon: DogIcon,
    group: 'wildCards',
    get label() {
      return m.deviceIcons_kind_dog_label();
    },
  },
  gameController: {
    icon: GameControllerIcon,
    group: 'wildCards',
    get label() {
      return m.deviceIcons_kind_gameController_label();
    },
  },
  coffee: {
    icon: CoffeeIcon,
    group: 'wildCards',
    get label() {
      return m.deviceIcons_kind_coffee_label();
    },
  },
  planet: {
    icon: PlanetIcon,
    group: 'wildCards',
    get label() {
      return m.deviceIcons_kind_planet_label();
    },
  },
  pottedPlant: {
    icon: PottedPlantIcon,
    group: 'wildCards',
    get label() {
      return m.deviceIcons_kind_pottedPlant_label();
    },
  },
} satisfies Record<DeviceKind, DeviceIconDefinition>;

function fallbackDeviceKind(os: string | null | undefined): DeviceKind {
  const normalized = os?.toLowerCase();
  if (normalized === 'linux') return 'server';
  return 'desktop';
}

export function resolveDeviceKind(source: DeviceIconSource): DeviceKind {
  if (source.deviceIcon !== 'auto' && isDeviceKind(source.deviceIcon)) return source.deviceIcon;
  if (isDetectedDeviceKind(source.detectedDeviceKind)) return source.detectedDeviceKind;
  return fallbackDeviceKind(source.os);
}

export function deviceIconOptions(source: DeviceIconSource): readonly DeviceIconOption[] {
  const automaticKind = resolveDeviceKind({ ...source, deviceIcon: 'auto' });
  return [
    {
      value: 'auto',
      kind: automaticKind,
      group: 'automatic',
      label: m.deviceIcons_picker_automatic_label({
        kind: DEVICE_ICON_REGISTRY[automaticKind].label,
      }),
    },
    ...DEVICE_ICON_KINDS.devices.map((kind) => ({
      value: kind,
      kind,
      group: 'devices' as const,
      label: DEVICE_ICON_REGISTRY[kind].label,
    })),
    ...DEVICE_ICON_KINDS.wildCards.map((kind) => ({
      value: kind,
      kind,
      group: 'wildCards' as const,
      label: DEVICE_ICON_REGISTRY[kind].label,
    })),
  ];
}
