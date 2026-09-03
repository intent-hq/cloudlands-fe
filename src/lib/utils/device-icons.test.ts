import { describe, expect, it } from 'vitest';
import { DEVICE_ICON_REGISTRY, deviceIconOptions, resolveDeviceKind } from './device-icons';
import { DEVICE_KINDS } from '$shared/types/connections';

describe('device icons', () => {
  it('registers every shared device kind with a label and icon', () => {
    expect(Object.keys(DEVICE_ICON_REGISTRY).sort()).toEqual([...DEVICE_KINDS].sort());
    for (const kind of DEVICE_KINDS) {
      expect(DEVICE_ICON_REGISTRY[kind].label).not.toBe('');
      expect(DEVICE_ICON_REGISTRY[kind].icon).toBeTruthy();
    }
  });

  it('resolves override before detection and detection before OS fallback', () => {
    expect(
      resolveDeviceKind({ deviceIcon: 'cat', detectedDeviceKind: 'macMini', os: 'linux' }),
    ).toBe('cat');
    expect(
      resolveDeviceKind({ deviceIcon: 'auto', detectedDeviceKind: 'macStudio', os: 'linux' }),
    ).toBe('macStudio');
    expect(resolveDeviceKind({ detectedDeviceKind: null, os: 'linux' })).toBe('server');
    expect(resolveDeviceKind({ detectedDeviceKind: null, os: 'macos' })).toBe('desktop');
    expect(resolveDeviceKind({})).toBe('desktop');
  });

  it('puts Automatic first and describes detection rather than the current override', () => {
    const options = deviceIconOptions({ deviceIcon: 'dog', detectedDeviceKind: 'macMini' });
    expect(options).toHaveLength(DEVICE_KINDS.length + 1);
    expect(options[0]).toMatchObject({ value: 'auto', kind: 'macMini', group: 'automatic' });
    expect(options[0].label).toContain(DEVICE_ICON_REGISTRY.macMini.label);
    expect(options.slice(1, 7).every((option) => option.group === 'devices')).toBe(true);
    expect(options.slice(7).every((option) => option.group === 'wildCards')).toBe(true);
  });
});
