import { describe, expect, it } from 'vitest';
import { showsNoBackendScreen } from './no-backend-gate';

describe('showsNoBackendScreen', () => {
  it.each(['/', '/workspace/ws-1', '/agent/a-1', '/settingsfoo'])(
    'replaces %s when no machine is bound',
    (pathname) => {
      expect(showsNoBackendScreen(true, pathname)).toBe(true);
    },
  );

  it.each(['/settings', '/settings/'])('keeps %s reachable to add a machine', (pathname) => {
    expect(showsNoBackendScreen(true, pathname)).toBe(false);
  });

  it('never shows once a machine is bound', () => {
    expect(showsNoBackendScreen(false, '/')).toBe(false);
    expect(showsNoBackendScreen(false, '/workspace/ws-1')).toBe(false);
  });
});
