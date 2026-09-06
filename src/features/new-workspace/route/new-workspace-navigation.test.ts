// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildNewWorkspaceRoute, consumeNewWorkspaceStartInput } from './new-workspace-navigation';

const input = { prefill: { repoPath: '/projects/intent' } };

describe('new workspace navigation', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('uses session storage for same-window start input', () => {
    const route = buildNewWorkspaceRoute(input, { instanceId: 'same-window' });

    expect(route).toBe('/workspace/new?instance=same-window');
    expect(consumeNewWorkspaceStartInput(new URL(route, 'https://intent.test'))).toEqual(input);
    expect(sessionStorage.getItem('new-workspace-start:same-window')).toBeNull();
  });

  it('carries new-window start input in the URL', () => {
    const route = buildNewWorkspaceRoute(input, {
      instanceId: 'new-window',
      carrier: 'url',
    });

    expect(sessionStorage.getItem('new-workspace-start:new-window')).toBeNull();
    expect(consumeNewWorkspaceStartInput(new URL(route, 'https://intent.test'))).toEqual(input);
  });

  it('falls back to the URL when session storage rejects the write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage blocked', 'SecurityError');
    });

    const route = buildNewWorkspaceRoute(input, { instanceId: 'blocked-storage' });

    expect(new URL(route, 'https://intent.test').searchParams.get('start')).not.toBeNull();
    expect(consumeNewWorkspaceStartInput(new URL(route, 'https://intent.test'))).toEqual(input);
  });
});
