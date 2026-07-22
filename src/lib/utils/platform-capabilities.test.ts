import { describe, expect, it } from 'vitest';

import {
  capabilitiesForPlatform,
  detectPlatform,
  getCapabilities,
  getPlatform,
  hasCapability,
  isElectronPlatform,
  type PlatformCapabilities,
} from './platform-capabilities';

describe('platform-capabilities', () => {
  describe('detectPlatform', () => {
    it('returns web when there is no window', () => {
      expect(detectPlatform(undefined)).toBe('web');
    });

    it('returns web when window has no electronAPI', () => {
      expect(detectPlatform({})).toBe('web');
    });

    it('returns electron when a real preload bridge is present', () => {
      const win = {
        electronAPI: { versions: { node: '20.0.0', chrome: '120.0.0', electron: '31.0.0' } },
      };
      expect(detectPlatform(win)).toBe('electron');
    });

    it('treats the dev browser mock as web', () => {
      const win = {
        electronAPI: {
          versions: { node: '20.0.0', chrome: '120.0.0', electron: '0.0.0-browser' },
        },
      };
      expect(detectPlatform(win)).toBe('web');
    });

    it('returns electron when electronAPI exists without versions (test mocks)', () => {
      // The vitest global setup installs an electronAPI mock without a
      // `versions` field; existing suites rely on it counting as Electron.
      expect(detectPlatform({ electronAPI: {} })).toBe('electron');
    });
  });

  describe('capabilitiesForPlatform', () => {
    it('grants all capabilities on electron', () => {
      const caps = capabilitiesForPlatform('electron');
      for (const value of Object.values(caps)) {
        expect(value).toBe(true);
      }
    });

    it('denies all capabilities on web', () => {
      const caps = capabilitiesForPlatform('web');
      for (const value of Object.values(caps)) {
        expect(value).toBe(false);
      }
    });

    it('exposes the expected capability keys', () => {
      const expected: Array<keyof PlatformCapabilities> = [
        'windowChrome',
        'nativeDialogs',
        'shellIntegration',
        'externalEditors',
        'browserPanel',
        'autoUpdate',
        'deeplinks',
        'nativeNotifications',
        'ssh',
      ];
      expect(Object.keys(capabilitiesForPlatform('web')).sort()).toEqual([...expected].sort());
    });
  });

  describe('current-environment helpers (jsdom + test-setup electronAPI mock)', () => {
    it('detects electron because test-setup installs an electronAPI mock', () => {
      expect(getPlatform()).toBe('electron');
      expect(isElectronPlatform()).toBe(true);
      expect(hasCapability('externalEditors')).toBe(true);
      expect(getCapabilities().browserPanel).toBe(true);
    });

    it('reflects removal of electronAPI as web', () => {
      const original = (window as any).electronAPI;
      try {
        delete (window as any).electronAPI;
        expect(getPlatform()).toBe('web');
        expect(isElectronPlatform()).toBe(false);
        expect(hasCapability('windowChrome')).toBe(false);
      } finally {
        (window as any).electronAPI = original;
      }
    });
  });
});
