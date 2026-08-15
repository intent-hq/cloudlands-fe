import { describe, expect, it } from 'vitest';

import { isWorkspaceCommandPayload, workspaceCommandPayload } from './workspace-command-payloads';

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
});
