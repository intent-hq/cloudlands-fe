/**
 * Tests for CDP Connection Manager
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
} from 'vitest';
import {
  CdpConnectionManager,
  type ConsoleLogEntry,
} from '../cdp-connection';

// Mock chrome-remote-interface
vi.mock('chrome-remote-interface', () => ({
  default: vi.fn(),
}));

// Mock the Logger
vi.mock('../../../shared/logger', () => ({
  Logger: class MockLogger {
    debug = vi.fn();
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
}));

describe('CdpConnectionManager', () => {
  let manager: CdpConnectionManager;

  beforeEach(() => {
    manager = new CdpConnectionManager(9222);
  });

  describe('constructor', () => {
    it('should create manager with default port', () => {
      const defaultManager = new CdpConnectionManager();
      expect(defaultManager).toBeDefined();
    });

    it('should create manager with custom port', () => {
      const customManager = new CdpConnectionManager(9333);
      expect(customManager).toBeDefined();
    });
  });

  describe('isConnected', () => {
    it('should return false when not connected', () => {
      expect(manager.isConnected()).toBe(false);
    });
  });

  describe('getClient', () => {
    it('should throw when not connected', () => {
      expect(() => manager.getClient()).toThrow('CDP client not connected');
    });
  });

  describe('getConsoleLogs', () => {
    it('should return empty array when no logs', () => {
      const logs = manager.getConsoleLogs();
      expect(logs).toEqual([]);
    });

    it('should return empty array with count option', () => {
      const logs = manager.getConsoleLogs({ count: 10 });
      expect(logs).toEqual([]);
    });

    it('should return empty array with filter option', () => {
      const logs = manager.getConsoleLogs({ filter: 'test' });
      expect(logs).toEqual([]);
    });

    it('should return empty array with types option', () => {
      const logs = manager.getConsoleLogs({ types: ['error'] });
      expect(logs).toEqual([]);
    });
  });

  describe('getConsoleLogCount', () => {
    it('should return 0 when no logs', () => {
      expect(manager.getConsoleLogCount()).toBe(0);
    });
  });

  describe('ConsoleLogEntry type', () => {
    it('should create valid log entry', () => {
      const entry: ConsoleLogEntry = {
        timestamp: Date.now(),
        type: 'log',
        args: ['test message', 123],
      };

      expect(entry.type).toBe('log');
      expect(entry.args).toHaveLength(2);
    });

    it('should create log entry with stack trace', () => {
      const entry: ConsoleLogEntry = {
        timestamp: Date.now(),
        type: 'error',
        args: ['Error occurred'],
        stackTrace: { callFrames: [] },
      };

      expect(entry.stackTrace).toBeDefined();
    });
  });
});
