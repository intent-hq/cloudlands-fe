/**
 * WebSocket Auth Tests
 *
 * Tests token generation, storage, validation, and bearer token extraction.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock electron-store
const mockStore: Record<string, any> = {};
vi.mock('electron-store', () => {
  return {
    __esModule: true,
    default: function MockElectronStore() {
      return {
        set: (key: string, value: any) => { mockStore[key] = value; },
        get: (key: string, defaultValue?: any) => key in mockStore ? mockStore[key] : defaultValue,
        store: mockStore,
      };
    },
  };
});

// Mock electron app
vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/tmp'), isPackaged: false },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}));

import {
  generateToken,
  getOrCreateToken,
  validateToken,
  isWebSocketApiEnabled,
  setWebSocketApiEnabled,
  isDiscoveryEnabled,
  setDiscoveryEnabled,
  extractBearerToken,
} from '../websocket-auth';

describe('WebSocket Auth', () => {
  beforeEach(() => {
    // Clear mockStore between tests
    Object.keys(mockStore).forEach((key) => delete mockStore[key]);
  });

  describe('generateToken()', () => {
    it('returns a 64-character hex string', () => {
      const token = generateToken();
      expect(token).toHaveLength(64);
      expect(token).toMatch(/^[0-9a-f]{64}$/);
    });

    it('stores the token in electron-store', () => {
      const token = generateToken();
      expect(mockStore['websocketApiToken']).toBe(token);
    });

    it('generates unique tokens on each call', () => {
      const token1 = generateToken();
      const token2 = generateToken();
      expect(token1).not.toBe(token2);
    });
  });

  describe('getOrCreateToken()', () => {
    it('returns existing token if one is stored', () => {
      mockStore['websocketApiToken'] = 'existing-token-abc';
      const token = getOrCreateToken();
      expect(token).toBe('existing-token-abc');
    });

    it('generates a new token if none exists', () => {
      const token = getOrCreateToken();
      expect(token).toHaveLength(64);
      expect(mockStore['websocketApiToken']).toBe(token);
    });
  });

  describe('validateToken()', () => {
    it('returns true for correct token', () => {
      const token = generateToken();
      expect(validateToken(token)).toBe(true);
    });

    it('returns false for wrong token', () => {
      generateToken();
      expect(validateToken('wrong-token')).toBe(false);
    });

    it('returns false for empty string', () => {
      generateToken();
      expect(validateToken('')).toBe(false);
    });

    it('returns false for null/undefined', () => {
      generateToken();
      expect(validateToken(null as any)).toBe(false);
      expect(validateToken(undefined as any)).toBe(false);
    });

    it('handles different length tokens without crashing', () => {
      generateToken(); // 64 chars
      expect(validateToken('short')).toBe(false);
      expect(validateToken('a'.repeat(128))).toBe(false);
    });

    it('does not generate a token when validating before one exists', () => {
      expect(validateToken('candidate')).toBe(false);
      expect(mockStore['websocketApiToken']).toBeUndefined();
    });
  });

  describe('isWebSocketApiEnabled()', () => {
    it('defaults to false when not set', () => {
      expect(isWebSocketApiEnabled()).toBe(false);
    });

    it('returns true when enabled', () => {
      mockStore['websocketApiEnabled'] = true;
      expect(isWebSocketApiEnabled()).toBe(true);
    });

    it('returns false when explicitly disabled', () => {
      mockStore['websocketApiEnabled'] = false;
      expect(isWebSocketApiEnabled()).toBe(false);
    });
  });

  describe('setWebSocketApiEnabled()', () => {
    it('sets enabled state to true', () => {
      setWebSocketApiEnabled(true);
      expect(mockStore['websocketApiEnabled']).toBe(true);
    });

    it('sets enabled state to false', () => {
      setWebSocketApiEnabled(false);
      expect(mockStore['websocketApiEnabled']).toBe(false);
    });
  });

  describe('isDiscoveryEnabled()', () => {
    it('defaults to false when not set', () => {
      expect(isDiscoveryEnabled()).toBe(false);
    });

    it('returns true when discovery is enabled', () => {
      mockStore['websocketApiDiscoveryEnabled'] = true;
      expect(isDiscoveryEnabled()).toBe(true);
    });

    it('returns false when discovery is explicitly disabled', () => {
      mockStore['websocketApiDiscoveryEnabled'] = false;
      expect(isDiscoveryEnabled()).toBe(false);
    });
  });

  describe('setDiscoveryEnabled()', () => {
    it('sets discovery enabled state to true', () => {
      setDiscoveryEnabled(true);
      expect(mockStore['websocketApiDiscoveryEnabled']).toBe(true);
    });

    it('sets discovery enabled state to false', () => {
      setDiscoveryEnabled(false);
      expect(mockStore['websocketApiDiscoveryEnabled']).toBe(false);
    });
  });

  describe('extractBearerToken()', () => {
    it('extracts token from valid Bearer header', () => {
      expect(extractBearerToken('Bearer my-token-123')).toBe('my-token-123');
    });

    it('is case-insensitive for Bearer prefix', () => {
      expect(extractBearerToken('bearer my-token')).toBe('my-token');
      expect(extractBearerToken('BEARER my-token')).toBe('my-token');
    });

    it('returns null for missing header', () => {
      expect(extractBearerToken(undefined)).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(extractBearerToken('')).toBeNull();
    });

    it('returns null for malformed header (no Bearer prefix)', () => {
      expect(extractBearerToken('Basic abc123')).toBeNull();
      expect(extractBearerToken('just-a-token')).toBeNull();
    });

    it('returns null for Bearer with no token', () => {
      expect(extractBearerToken('Bearer ')).toBeNull();
    });
  });
});

