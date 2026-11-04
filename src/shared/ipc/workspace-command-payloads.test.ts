import { describe, expect, it } from 'vitest';

import {
  clampBrowserViewportDimension,
  isWorkspaceCommandPayload,
  workspaceCommandPayload,
} from './workspace-command-payloads';

describe('workspace command payloads', () => {
  it('creates the exact workspace context payload for a valid ID', () => {
    expect(workspaceCommandPayload('ws-2')).toEqual({ workspaceId: 'ws-2' });
  });

  it.each([undefined, null, '', 42, { workspaceId: '' }])(
    'rejects invalid workspace context %j without fallback',
    (value) => {
      expect(workspaceCommandPayload(value)).toBeNull();
      expect(isWorkspaceCommandPayload(value)).toBe(false);
    },
  );

  it('accepts only a non-empty workspaceId field', () => {
    expect(isWorkspaceCommandPayload({ workspaceId: 'ws-2', ignored: true })).toBe(true);
    expect(isWorkspaceCommandPayload({ workspaceId: 'ws-2', workspace_id: 'wrong' })).toBe(true);
  });

  it('clamps browser viewport dimensions into [320, 3840] and rounds them', () => {
    expect(clampBrowserViewportDimension(100)).toBe(320);
    expect(clampBrowserViewportDimension(50000)).toBe(3840);
    expect(clampBrowserViewportDimension(1900.4)).toBe(1900);
    expect(clampBrowserViewportDimension(1000.6)).toBe(1001);
  });
});
