import { describe, expect, it } from 'vitest';
import { isWorkspaceBrowserClient } from './browser-clients';

describe('isWorkspaceBrowserClient', () => {
  it('accepts answers without a target exactly as before', () => {
    expect(isWorkspaceBrowserClient({ source: 'default', resolved: null })).toBe(true);
    expect(
      isWorkspaceBrowserClient({ source: 'workspace', clientId: 'cli-a', resolved: null }),
    ).toBe(true);
    expect(isWorkspaceBrowserClient({ source: 'tabs', resolved: null })).toBe(false);
  });

  it('accepts a routed target and tolerates an unrecognised via', () => {
    expect(
      isWorkspaceBrowserClient({
        source: 'default',
        resolved: null,
        target: { clientId: 'legacy-host', via: 'tabs' },
      }),
    ).toBe(true);
    expect(
      isWorkspaceBrowserClient({
        source: 'default',
        resolved: null,
        target: { clientId: 'cli-a', via: 'future-rule' },
      }),
    ).toBe(true);
  });

  it('ignores a malformed target instead of rejecting the answer', () => {
    expect(
      isWorkspaceBrowserClient({ source: 'default', resolved: null, target: { via: 'tabs' } }),
    ).toBe(true);
  });
});
