import { describe, expect, it } from 'vitest';
import {
  defaultDockContextLinkKey,
  dockContextLinkKey,
  dockContextLinkKeys,
  parseDockContextPreferences,
  type DockForegroundObservation,
} from './dock-context-links';

function observation(url: string | null): DockForegroundObservation {
  return {
    sequence: 1,
    contextVersion: 'observed-tab',
    backendId: 'local',
    identityKey: `url:${url}`,
    identityKind: url ? 'url' : 'app',
    self: false,
    appId: 'com.google.Chrome',
    appName: 'Google Chrome',
    url,
    icon: null,
  };
}

function preferences(key: string) {
  return parseDockContextPreferences({
    version: 1,
    links: {
      [key]: {
        workspaceId: 'chosen-workspace',
        revision: 1,
        policy: { follows: 0, decision: 'unasked' },
      },
    },
  });
}

describe('explicit foreground tab links', () => {
  it.each([
    'http://localhost:3000/review?mode=preview#draft',
    'http://127.0.0.1:5190/workspace/example',
    'http://[::1]:8120/',
    'http://daemon.localhost:8120/sandbox',
    'https://example.test:8443/document',
  ])('persists and follows the exact selected address %s', (url) => {
    const value = observation(url);
    const key = dockContextLinkKey(value, 'tab');
    expect(key).toBe(`url:${new URL(url).href}`);
    const saved = preferences(key!);
    expect(saved.links[key!]?.workspaceId).toBe('chosen-workspace');
    expect(dockContextLinkKeys(value, saved)).toEqual([key]);
    // Implicit project/service inference still cannot claim an ephemeral port.
    expect(defaultDockContextLinkKey(value)).toBeNull();
  });

  it('keeps different ports, paths and protocols separate', () => {
    const key = dockContextLinkKey(observation('http://localhost:3000/a'), 'tab')!;
    const saved = preferences(key);
    for (const url of [
      'http://localhost:3001/a',
      'http://localhost:3000/b',
      'https://localhost:3000/a',
    ]) {
      expect(dockContextLinkKeys(observation(url), saved)).toEqual([]);
    }
  });

  it.each([
    'javascript:alert(1)',
    'file:///tmp/document',
    'https://user:secret@example.test/document',
    'not a URL',
  ])('rejects unsupported or credential-bearing addresses %s', (url) => {
    expect(dockContextLinkKey(observation(url), 'tab')).toBeNull();
    expect(preferences(`url:${url}`).links).toEqual({});
  });

  it('does not turn local addresses into persisted project ownership', () => {
    expect(preferences('project:http://localhost:3000/').links).toEqual({});
    expect(preferences('project:https://example.test:8443/project/').links).toEqual({});
  });

  it('still refuses unknown documents and Intent’s own dock', () => {
    expect(dockContextLinkKey(observation(null), 'tab')).toBeNull();
    expect(
      dockContextLinkKey({ ...observation('https://example.test'), self: true }, 'tab'),
    ).toBeNull();
  });
});
