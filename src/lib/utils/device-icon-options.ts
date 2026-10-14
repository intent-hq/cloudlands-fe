import {
  DETECTED_DEVICE_KINDS,
  WILD_CARD_DEVICE_KINDS,
  type DeviceIconChoice,
  type DeviceKind,
} from '$shared/types/connections';
import { m } from '$shared/paraglide/messages.js';
import { resolveDeviceKind, type DeviceIconSource } from './device-icon-resolver';

type DeviceIconGroup = 'devices' | 'wildCards';
export interface DeviceIconMetadata {
  group: DeviceIconGroup;
  readonly label: string;
}

export interface DeviceIconOption {
  value: DeviceIconChoice;
  kind: DeviceKind;
  group: DeviceIconGroup | 'automatic';
  label: string;
}

const DEVICE_ICON_KINDS = {
  devices: DETECTED_DEVICE_KINDS,
  wildCards: WILD_CARD_DEVICE_KINDS,
} as const satisfies Record<DeviceIconGroup, readonly DeviceKind[]>;

export const DEVICE_ICON_METADATA = {
  macMini: {
    group: 'devices',
    get label() {
      return m.deviceIcons_kind_macMini_label();
    },
  },
  macStudio: {
    group: 'devices',
    get label() {
      return m.deviceIcons_kind_macStudio_label();
    },
  },
  laptop: {
    group: 'devices',
    get label() {
      return m.deviceIcons_kind_laptop_label();
    },
  },
  desktop: {
    group: 'devices',
    get label() {
      return m.deviceIcons_kind_desktop_label();
    },
  },
  server: {
    group: 'devices',
    get label() {
      return m.deviceIcons_kind_server_label();
    },
  },
  cloudVm: {
    group: 'devices',
    get label() {
      return m.deviceIcons_kind_cloudVm_label();
    },
  },
  robot: {
    group: 'wildCards',
    get label() {
      return m.deviceIcons_kind_robot_label();
    },
  },
  rocket: {
    group: 'wildCards',
    get label() {
      return m.deviceIcons_kind_rocket_label();
    },
  },
  flyingSaucer: {
    group: 'wildCards',
    get label() {
      return m.deviceIcons_kind_flyingSaucer_label();
    },
  },
  ghost: {
    group: 'wildCards',
    get label() {
      return m.deviceIcons_kind_ghost_label();
    },
  },
  cat: {
    group: 'wildCards',
    get label() {
      return m.deviceIcons_kind_cat_label();
    },
  },
  dog: {
    group: 'wildCards',
    get label() {
      return m.deviceIcons_kind_dog_label();
    },
  },
  gameController: {
    group: 'wildCards',
    get label() {
      return m.deviceIcons_kind_gameController_label();
    },
  },
  coffee: {
    group: 'wildCards',
    get label() {
      return m.deviceIcons_kind_coffee_label();
    },
  },
  planet: {
    group: 'wildCards',
    get label() {
      return m.deviceIcons_kind_planet_label();
    },
  },
  pottedPlant: {
    group: 'wildCards',
    get label() {
      return m.deviceIcons_kind_pottedPlant_label();
    },
  },
} satisfies Record<DeviceKind, DeviceIconMetadata>;

export function deviceIconOptions(source: DeviceIconSource): readonly DeviceIconOption[] {
  const automaticKind = resolveDeviceKind({ ...source, deviceIcon: 'auto' });
  return [
    {
      value: 'auto',
      kind: automaticKind,
      group: 'automatic',
      label: m.deviceIcons_picker_automatic_label({
        kind: DEVICE_ICON_METADATA[automaticKind].label,
      }),
    },
    ...DEVICE_ICON_KINDS.devices.map((kind) => ({
      value: kind,
      kind,
      group: 'devices' as const,
      label: DEVICE_ICON_METADATA[kind].label,
    })),
    ...DEVICE_ICON_KINDS.wildCards.map((kind) => ({
      value: kind,
      kind,
      group: 'wildCards' as const,
      label: DEVICE_ICON_METADATA[kind].label,
    })),
  ];
}
