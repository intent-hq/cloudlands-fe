/**
 * Auto-Update IPC Contract Tests
 *
 * Tests that the SET_CHANNEL IPC request conforms to the wire contract.
 */

import { describe, it, expect } from 'vitest';
import { SetChannelRequestSchema } from '../auto-update-validation';

describe('Auto-Update IPC Contracts', () => {
  describe('SET_CHANNEL request', () => {
    it('should accept valid "stable" channel', () => {
      const request = { channel: 'stable' };
      const validated = SetChannelRequestSchema.parse(request);
      expect(validated.channel).toBe('stable');
    });

    it('should accept valid "beta" channel', () => {
      const request = { channel: 'beta' };
      const validated = SetChannelRequestSchema.parse(request);
      expect(validated.channel).toBe('beta');
    });

    it('should accept valid "alpha" channel', () => {
      const request = { channel: 'alpha' };
      const validated = SetChannelRequestSchema.parse(request);
      expect(validated.channel).toBe('alpha');
    });

    it('should reject invalid channel "nightly"', () => {
      const request = { channel: 'nightly' };
      expect(() => SetChannelRequestSchema.parse(request)).toThrow();
    });

    it('should reject invalid channel "Beta" (wrong case)', () => {
      const request = { channel: 'Beta' };
      expect(() => SetChannelRequestSchema.parse(request)).toThrow();
    });

    it('should reject missing channel field', () => {
      const request = {};
      expect(() => SetChannelRequestSchema.parse(request)).toThrow();
    });

    it('should reject channel as number', () => {
      const request = { channel: 1 };
      expect(() => SetChannelRequestSchema.parse(request)).toThrow();
    });

    it('should reject channel as null', () => {
      const request = { channel: null };
      expect(() => SetChannelRequestSchema.parse(request)).toThrow();
    });
  });
});
