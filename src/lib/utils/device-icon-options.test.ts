import { afterEach, expect, it } from 'vitest';
import { getLocale, setLocale } from '$shared/paraglide/runtime.js';
import { DEVICE_ICON_METADATA, deviceIconOptions } from './device-icon-options';
import { DEVICE_ICON_REGISTRY } from './device-icons';

const originalLocale = getLocale();
afterEach(() => setLocale(originalLocale, { reload: false }));

it('updates both framework labels after a locale change without replacing the icon', () => {
  setLocale('en', { reload: false });
  const english = DEVICE_ICON_METADATA.cat.label;
  const originalIcon = DEVICE_ICON_REGISTRY.cat.icon;
  setLocale('de', { reload: false });
  expect(DEVICE_ICON_METADATA.cat.label).not.toBe(english);
  expect(DEVICE_ICON_REGISTRY.cat.label).toBe(DEVICE_ICON_METADATA.cat.label);
  expect(DEVICE_ICON_REGISTRY.cat.icon).toBe(originalIcon);
  expect(
    deviceIconOptions({ detectedDeviceKind: 'laptop' }).find((option) => option.value === 'cat')
      ?.label,
  ).toBe(DEVICE_ICON_REGISTRY.cat.label);
});
