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
import { getAllowedChannels, isDynamicChannel } from '../../ipc-registry';

const isValidChannel = (channel: string) =>
  getAllowedChannels().includes(channel) || isDynamicChannel(channel);

describe('IPC Channels', () => {
  describe('Channel Constants', () => {
    it('should have agent channels defined', () => {
      expect(AGENT_CHANNELS.CREATE).toBe('agent:create');
      expect(AGENT_CHANNELS.SEND_MESSAGE).toBe('agent:send-message');
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

    it('should reject removed legacy file watcher channels', () => {
      expect(isValidChannel('file:watch')).toBe(false);
      expect(isValidChannel('file:unwatch')).toBe(false);
    });

    it('should reject removed specialist file watcher channels', () => {
      expect(isValidChannel('specialists:files-changed')).toBe(false);
    });

    it('should reject invalid channels', () => {
      expect(isValidChannel('invalid:channel')).toBe(false);
      expect(isValidChannel('agent:invalid')).toBe(false);
    });

    it('should reject retired agent backend channels', () => {
      expect(isValidChannel('agent:backend:create')).toBe(false);
      expect(isValidChannel('agent:backend:get-status')).toBe(false);
      expect(isValidChannel('agent:backend:cancel-stream')).toBe(false);
      expect(isValidChannel('agent:backend:stop')).toBe(false);
      expect(isValidChannel('agent:backend:get')).toBe(false);
      expect(isValidChannel('agent:backend:list')).toBe(false);
      expect(isValidChannel('agent:backend:delete')).toBe(false);
      expect(isValidChannel('agent:backend:isActive')).toBe(false);
      expect(isValidChannel('agent:backend:resume')).toBe(false);
      expect(isValidChannel('agent:backend:check-process')).toBe(false);
      expect(isValidChannel('agent:backend:reconnect')).toBe(false);
      expect(isValidChannel('agent:backend:resume-stream')).toBe(false);
      expect(isValidChannel('agent:backend:get-checkpoint')).toBe(false);
      expect(isValidChannel('agent:stream-starting')).toBe(false);
      // Final agent:backend:* retirement (main-process handlers deleted)
      expect(isValidChannel('agent:backend:stream-message')).toBe(false);
      expect(isValidChannel('agent:backend:queue-message')).toBe(false);
      expect(isValidChannel('agent:backend:edit-queued')).toBe(false);
      expect(isValidChannel('agent:backend:remove-queued')).toBe(false);
      expect(isValidChannel('agent:backend:get-queue')).toBe(false);
      expect(isValidChannel('agent:backend:force-message')).toBe(false);
      // Wake-handshake / backend-health event channels retired with
      // ConsolidatedBackendService
      expect(isValidChannel('agent:prepare-handler')).toBe(false);
      expect(isValidChannel('agent:handler-ready')).toBe(false);
      expect(isValidChannel('health:check')).toBe(false);
    });

    it('should validate dynamic channels', () => {
      expect(isValidChannel('agent:stream:123')).toBe(true);
      expect(isValidChannel('agent:stream:ping:123')).toBe(true);
      expect(isValidChannel('agent:stream:pong')).toBe(true);
      expect(isValidChannel('auggie:stream:123')).toBe(true);
      expect(isValidChannel('terminal:output:456')).toBe(true);
      expect(isValidChannel('agent-stream-123')).toBe(false);
    });
  });

  describe('Dynamic Channels', () => {
    it('should identify dynamic channels', () => {
      expect(isDynamicChannel('agent:stream:123')).toBe(true);
      expect(isDynamicChannel('agent:stream:ping:123')).toBe(true);
      expect(isDynamicChannel('agent:stream:pong')).toBe(true);
      expect(isDynamicChannel('auggie:stream:123')).toBe(true);
      expect(isDynamicChannel('terminal:output:456')).toBe(true);
      expect(isDynamicChannel('agent-stream-123')).toBe(false);
    });

    it('should not identify static channels as dynamic', () => {
      expect(isDynamicChannel('agent:create')).toBe(false);
      expect(isDynamicChannel('workspace:list')).toBe(false);
    });
  });

  describe('Channel Utilities', () => {
    it('should get all allowed channels', () => {
      const channels = getAllowedChannels();
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
});
