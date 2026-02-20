/**
 * IPC Channels Tests
 *
 * Tests for channel definitions, validation, and type safety
 */

import { describe, it, expect } from 'vitest';
import {
  AGENT_CHANNELS,
  WORKSPACE_CHANNELS,
  FILE_CHANNELS,
  SYSTEM_CHANNELS,
  TERMINAL_CHANNELS,
  getAllStaticChannels,
  createChannelName,
} from '../channels';
import {
  isValidChannel,
  assertValidChannel,
  isDynamicChannel,
  getDynamicChannelPattern,
  validateChannel,
  getAllowedChannelsList,
  requiresAuth,
  getRateLimit,
} from '../validation';

describe('IPC Channels', () => {
  describe('Channel Constants', () => {
    it('should have agent channels defined', () => {
      expect(AGENT_CHANNELS.CREATE).toBe('agent:create');
      expect(AGENT_CHANNELS.SEND_MESSAGE).toBe('agent:send-message');
      expect(AGENT_CHANNELS.PERSISTENCE_SAVE).toBe('agent:persistence:save');
    });

    it('should have workspace channels defined', () => {
      expect(WORKSPACE_CHANNELS.CREATE).toBe('workspace:create');
      expect(WORKSPACE_CHANNELS.LIST).toBe('workspace:list');
    });

    it('should have file channels defined', () => {
      expect(FILE_CHANNELS.READ).toBe('file:read');
      expect(FILE_CHANNELS.WRITE).toBe('file:write');
    });

    it('should have system channels defined', () => {
      expect(SYSTEM_CHANNELS.GET_INFO).toBe('system:get-info');
    });

    it('should have terminal channels defined', () => {
      expect(TERMINAL_CHANNELS.PROFESSIONAL_CREATE).toBe('terminal:professional:create');
    });
  });

  describe('Channel Validation', () => {
    it('should validate static channels', () => {
      expect(isValidChannel('agent:create')).toBe(true);
      expect(isValidChannel('workspace:list')).toBe(true);
      expect(isValidChannel('file:read')).toBe(true);
    });

    it('should reject invalid channels', () => {
      expect(isValidChannel('invalid:channel')).toBe(false);
      expect(isValidChannel('agent:invalid')).toBe(false);
    });

    it('should validate dynamic channels', () => {
      expect(isValidChannel('agent:stream:123')).toBe(true);
      expect(isValidChannel('terminal:output:456')).toBe(true);
    });

    it('should assert valid channels', () => {
      expect(() => assertValidChannel('agent:create')).not.toThrow();
      expect(() => assertValidChannel('workspace:list')).not.toThrow();
    });

    it('should throw on invalid channels', () => {
      expect(() => assertValidChannel('invalid:channel')).toThrow();
    });
  });

  describe('Dynamic Channels', () => {
    it('should identify dynamic channels', () => {
      expect(isDynamicChannel('agent:stream:123')).toBe(true);
      expect(isDynamicChannel('terminal:output:456')).toBe(true);
    });

    it('should not identify static channels as dynamic', () => {
      expect(isDynamicChannel('agent:create')).toBe(false);
      expect(isDynamicChannel('workspace:list')).toBe(false);
    });

    it('should get dynamic channel pattern', () => {
      expect(getDynamicChannelPattern('agent:stream:123')).toBe('agent:stream:');
      expect(getDynamicChannelPattern('terminal:output:456')).toBe('terminal:output:');
      expect(getDynamicChannelPattern('agent:create')).toBeNull();
    });
  });

  describe('Channel Utilities', () => {
    it('should validate and return channel', () => {
      expect(validateChannel('agent:create')).toBe('agent:create');
      expect(validateChannel('invalid:channel')).toBeNull();
    });

    it('should get all allowed channels', () => {
      const channels = getAllowedChannelsList();
      expect(channels.length).toBeGreaterThan(0);
      expect(channels).toContain('agent:create');
      expect(channels).toContain('workspace:list');
    });

    it('should get all static channels', () => {
      const channels = getAllStaticChannels();
      expect(channels.length).toBeGreaterThan(0);
      expect(channels).toContain('agent:create');
    });

    it('should create branded channel names', () => {
      const channel = createChannelName('agent:create');
      expect(channel).toBe('agent:create');
    });
  });

  describe('Channel Metadata', () => {
    it('should identify channels requiring auth', () => {
      expect(requiresAuth('agent:create')).toBe(true);
      expect(requiresAuth('agent:send-message')).toBe(true);
      expect(requiresAuth('workspace:list')).toBe(false);
    });

    it('should get rate limits', () => {
      expect(getRateLimit('agent:send-message')).toBe(10);
      expect(getRateLimit('agent:stream')).toBe(5);
      expect(getRateLimit('agent:create')).toBeNull();
    });
  });
});
