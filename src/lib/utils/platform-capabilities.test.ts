import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  capabilitiesForPlatform,
  detectPlatform,
  expectsElectronPreloadBridge,
  getCapabilities,
  getPlatform,
  hasCapability,
  isElectronPlatform,
  isElectronRuntime,
  type PlatformCapabilities,
} from './platform-capabilities';

const ELECTRON_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Cloudlands/2.3.0 Chrome/136.0.7103.115 Electron/36.4.0 Safari/537.36';
const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

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

  describe('isElectronRuntime', () => {
    it('recognizes the Electron user agent without consulting window.electronAPI', () => {
      const original = (window as any).electronAPI;
      try {
        delete (window as any).electronAPI;
        expect(isElectronRuntime(ELECTRON_UA)).toBe(true);
      } finally {
        (window as any).electronAPI = original;
      }
    });

    it('returns false for a plain browser user agent even when a mock electronAPI exists', () => {
      expect((window as any).electronAPI).toBeDefined();
      expect(isElectronRuntime(CHROME_UA)).toBe(false);
    });

    it('does not match "Electron" outside the Electron/<version> product token', () => {
      expect(isElectronRuntime('Mozilla/5.0 ElectronFan/1.0 Chrome/136.0.0.0')).toBe(false);
      expect(isElectronRuntime('')).toBe(false);
    });

    it('reads navigator.userAgent by default (jsdom is not Electron)', () => {
      expect(isElectronRuntime()).toBe(false);
    });
  });

  describe('expectsElectronPreloadBridge', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('is true for an Electron-built renderer running in Electron', () => {
      vi.stubEnv('INTENT_BUILD_TARGET', 'electron');
      expect(expectsElectronPreloadBridge(ELECTRON_UA)).toBe(true);
    });

    it('defaults to the Electron build when no build target is defined', () => {
      vi.stubEnv('INTENT_BUILD_TARGET', undefined);
      expect(expectsElectronPreloadBridge(ELECTRON_UA)).toBe(true);
    });

    it('is false for the web build even under the Electron UA (app <webview> has no preload)', () => {
      vi.stubEnv('INTENT_BUILD_TARGET', 'web');
      expect(expectsElectronPreloadBridge(ELECTRON_UA)).toBe(false);
    });

    it('is false for a plain browser regardless of build target', () => {
      vi.stubEnv('INTENT_BUILD_TARGET', 'electron');
      expect(expectsElectronPreloadBridge(CHROME_UA)).toBe(false);
    });
  });
});
