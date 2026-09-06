// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { buildNewWorkspaceRoute, consumeNewWorkspaceStartInput } from './new-workspace-navigation';

const input = { prefill: { repoPath: '/projects/intent' } };

describe('new workspace navigation', () => {
  beforeEach(() => sessionStorage.clear());

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
});
