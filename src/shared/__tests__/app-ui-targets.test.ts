import { describe, expect, it } from 'vitest';
import {
  getHighlightIdFromRoute,
  isResolvableNavTarget,
  resolveHashToTarget,
} from '../app-ui-targets';

describe('app UI targets registry', () => {
  it('resolves the default-model hash to the canonical background agent target', () => {
    const target = resolveHashToTarget('default-model');

    expect(target).toMatchObject({
      id: 'backgroundAgents.defaultModel',
      tab: 'agents',
      scrollSelector: '#default-model',
      highlightSelector: '[data-highlight-id="backgroundAgents.defaultModel"]',
    });
  });

  it('returns undefined for an unknown hash', () => {
    expect(resolveHashToTarget('does-not-exist')).toBeUndefined();
  });

  it('falls back to the raw hash when no registry target exists for a route', () => {
    expect(getHighlightIdFromRoute('/settings#custom-target')).toBe('custom-target');
  });
});

describe('isResolvableNavTarget', () => {
  it('accepts the home route', () => {
    expect(isResolvableNavTarget('/')).toBe(true);
  });

  it('accepts a registered settings path with no hash', () => {
    expect(isResolvableNavTarget('/settings')).toBe(true);
  });

  it('accepts a registered settings hash via alias', () => {
    expect(isResolvableNavTarget('/settings#mcp-servers')).toBe(true);
    expect(isResolvableNavTarget('/settings#default-model')).toBe(true);
  });

  it('rejects a registered path with an unknown hash', () => {
    expect(isResolvableNavTarget('/settings#totally-fake-anchor')).toBe(false);
  });

  it('accepts dynamic workspace and agent ids', () => {
    expect(isResolvableNavTarget('/workspace/abc-123')).toBe(true);
    expect(isResolvableNavTarget('/agent/agent-xyz')).toBe(true);
  });

  it('accepts /workspace/new (registered) and /workspace/creating (dynamic)', () => {
    expect(isResolvableNavTarget('/workspace/new')).toBe(true);
    expect(isResolvableNavTarget('/workspace/creating')).toBe(true);
  });

  it('rejects hallucinated top-level paths', () => {
    expect(isResolvableNavTarget('/specialists')).toBe(false);
    expect(isResolvableNavTarget('/workspaces/foo')).toBe(false);
    expect(isResolvableNavTarget('/nope')).toBe(false);
  });

  it('rejects absolute URLs with foreign schemes', () => {
    expect(isResolvableNavTarget('https://example.com')).toBe(false);
    expect(isResolvableNavTarget('file:///etc/passwd')).toBe(false);
  });

  it('accepts intent:// links (handled by the link handler)', () => {
    expect(isResolvableNavTarget('intent://local/note/spec')).toBe(true);
  });

  it('rejects empty, whitespace, and non-string targets', () => {
    expect(isResolvableNavTarget('')).toBe(false);
    expect(isResolvableNavTarget('   ')).toBe(false);
    expect(isResolvableNavTarget(undefined as unknown as string)).toBe(false);
    expect(isResolvableNavTarget(null as unknown as string)).toBe(false);
    expect(isResolvableNavTarget(42 as unknown as string)).toBe(false);
  });
});
