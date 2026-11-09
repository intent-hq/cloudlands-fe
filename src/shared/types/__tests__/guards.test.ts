/**
 * Tests for Type Guards
 */

import { describe, it, expect } from 'vitest';
import { isWorkspaceDisplayStatus, WORKSPACE_DISPLAY_STATUS_VALUES } from '../../types';
import { isPresenceRoster } from '../presence';

describe('Type Guards', () => {
  describe('isWorkspaceDisplayStatus', () => {
    it('accepts every canonical wire value, including needs_attention', () => {
      for (const value of WORKSPACE_DISPLAY_STATUS_VALUES) {
        expect(isWorkspaceDisplayStatus(value)).toBe(true);
      }
      expect(isWorkspaceDisplayStatus('needs_attention')).toBe(true);
    });

    it('rejects unknown or non-string values', () => {
      expect(isWorkspaceDisplayStatus('something_new')).toBe(false);
      expect(isWorkspaceDisplayStatus('')).toBe(false);
      expect(isWorkspaceDisplayStatus(undefined)).toBe(false);
      expect(isWorkspaceDisplayStatus(null)).toBe(false);
      expect(isWorkspaceDisplayStatus(42)).toBe(false);
    });
  });

  describe('isPresenceRoster', () => {
    const member = {
      principalId: 'p-1',
      login: 'alice',
      displayName: null,
      avatarUrl: null,
      focus: [{ workspaceId: 'ws-1' }],
      typing: [],
    };

    it('accepts a member whose profile fields are present, string or null', () => {
      expect(isPresenceRoster({ workspaceId: 'ws-1', members: [member] })).toBe(true);
      expect(
        isPresenceRoster({
          workspaceId: 'ws-1',
          members: [{ ...member, login: null, displayName: 'Alice', avatarUrl: 'https://a/b' }],
        }),
      ).toBe(true);
    });

    it('rejects a member that omits a required profile field instead of healing it to null', () => {
      for (const field of ['login', 'displayName', 'avatarUrl']) {
        const partial = Object.fromEntries(Object.entries(member).filter(([key]) => key !== field));
        expect(isPresenceRoster({ workspaceId: 'ws-1', members: [partial] })).toBe(false);
      }
    });
  });
});
