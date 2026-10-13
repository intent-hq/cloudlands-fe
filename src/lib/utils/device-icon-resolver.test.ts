import { describe, expect, it } from 'vitest';
import { resolveDeviceKind, type DeviceIconSource } from './device-icon-resolver';
import { resolveDeviceKind as publicResolveDeviceKind } from './device-icons';

describe('neutral device icon resolver', () => {
  it('keeps the existing public export bound to the same resolver', () => {
    expect(publicResolveDeviceKind).toBe(resolveDeviceKind);
  });

  it('uses a manual choice without consulting lower-priority detection or OS', () => {
    const record: DeviceIconSource = {
      deviceIcon: 'dog',
      get detectedDeviceKind() {
        throw new Error('Detection must not be read');
      },
      get os() {
        throw new Error('OS must not be read');
      },
    };
    expect(resolveDeviceKind(record)).toBe('dog');
  });

  it('uses automatic detection without consulting the fallback OS', () => {
    const record: DeviceIconSource = {
      deviceIcon: 'auto',
      detectedDeviceKind: 'macMini',
      get os() {
        throw new Error('OS must not be read');
      },
    };
    expect(resolveDeviceKind(record)).toBe('macMini');
  });

  it('retains exact fallback normalization without trimming unknown OS values', () => {
    expect(resolveDeviceKind({ os: 'LINUX' })).toBe('server');
    expect(resolveDeviceKind({ os: ' linux ' })).toBe('desktop');
    expect(resolveDeviceKind({ os: null })).toBe('desktop');
  });
});
