/**
 * WebSocket Discovery Tests
 *
 * Tests Bonjour/mDNS service discovery for the WebSocket API server.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoist mock functions so they're available when vi.mock factory runs
const { mockStop, mockPublish, mockDestroy, mockBonjourConstructor } = vi.hoisted(() => {
  const mockStop = vi.fn();
  const mockPublish = vi.fn().mockReturnValue({ stop: mockStop });
  const mockDestroy = vi.fn();
  const mockBonjourConstructor = vi.fn().mockImplementation(function () {
    return { publish: mockPublish, destroy: mockDestroy };
  });
  return { mockStop, mockPublish, mockDestroy, mockBonjourConstructor };
});

vi.mock('../utils/bonjour-runtime', () => ({
  getBonjourClass: vi.fn(() => mockBonjourConstructor),
}));

// Mock electron
vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/tmp'), isPackaged: false },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}));

import { startDiscovery, stopDiscovery, isDiscoveryActive } from '../websocket-discovery';

describe('WebSocket Discovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure clean state — stop any leftover service
    stopDiscovery();
    vi.clearAllMocks();
  });

  describe('startDiscovery(port)', () => {
    it('creates a Bonjour instance and publishes a service', () => {
      startDiscovery(8080);

      expect(mockBonjourConstructor).toHaveBeenCalledOnce();
      expect(mockPublish).toHaveBeenCalledOnce();
    });

    it('publishes with service type intent-ws', () => {
      startDiscovery(8080);

      const publishArgs = mockPublish.mock.calls[0][0];
      expect(publishArgs.type).toBe('intent-ws');
    });

    it('includes hostname in the service name', () => {
      startDiscovery(8080);

      const publishArgs = mockPublish.mock.calls[0][0];
      expect(publishArgs.name).toContain('Intent on');
    });

    it('publishes on the specified port', () => {
      startDiscovery(9999);

      const publishArgs = mockPublish.mock.calls[0][0];
      expect(publishArgs.port).toBe(9999);
    });

    it('includes version, path, and hostname in TXT record', () => {
      startDiscovery(8080);

      const publishArgs = mockPublish.mock.calls[0][0];
      expect(publishArgs.txt).toMatchObject({
        version: '1',
        path: '/ws',
      });
      expect(publishArgs.txt.hostname).toBeDefined();
      expect(typeof publishArgs.txt.hostname).toBe('string');
    });

    it('includes fp key in TXT record when certFingerprint is provided', () => {
      startDiscovery(8080, 'AB:CD:EF:12:34');

      const publishArgs = mockPublish.mock.calls[0][0];
      expect(publishArgs.txt.fp).toBe('AB:CD:EF:12:34');
    });

    it('does not include fp key in TXT record when certFingerprint is omitted', () => {
      startDiscovery(8080);

      const publishArgs = mockPublish.mock.calls[0][0];
      expect(publishArgs.txt.fp).toBeUndefined();
    });
  });

  describe('stopDiscovery()', () => {
    it('stops the published service', () => {
      startDiscovery(8080);
      stopDiscovery();

      expect(mockStop).toHaveBeenCalled();
    });

    it('destroys the Bonjour instance', () => {
      startDiscovery(8080);
      stopDiscovery();

      expect(mockDestroy).toHaveBeenCalled();
    });

    it('does not throw when called with no active service', () => {
      expect(() => stopDiscovery()).not.toThrow();
    });
  });

  describe('isDiscoveryActive()', () => {
    it('returns false initially', () => {
      expect(isDiscoveryActive()).toBe(false);
    });

    it('returns true after startDiscovery()', () => {
      startDiscovery(8080);

      expect(isDiscoveryActive()).toBe(true);
    });

    it('returns false after stopDiscovery()', () => {
      startDiscovery(8080);
      stopDiscovery();

      expect(isDiscoveryActive()).toBe(false);
    });
  });

  describe('startDiscovery() called twice', () => {
    it('cleans up previous service before publishing new one', () => {
      startDiscovery(8080);
      startDiscovery(9090);

      // First service should have been stopped/destroyed
      expect(mockStop).toHaveBeenCalled();
      expect(mockDestroy).toHaveBeenCalled();
      // New Bonjour instance created and service published twice total
      expect(mockBonjourConstructor).toHaveBeenCalledTimes(2);
      expect(mockPublish).toHaveBeenCalledTimes(2);
    });
  });
});

