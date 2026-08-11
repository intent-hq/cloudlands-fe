import { describe, expect, it } from 'vitest';
import {
  getAppUiTargets,
  getHighlightIdFromRoute,
  isResolvableNavTarget,
  resolveHashToTarget,
} from '../app-ui-targets';

describe('app UI targets registry', () => {
  it('keeps every settings route aligned with its tab and hash target', () => {
    const settingsTargets = getAppUiTargets().filter(
      (target) => target.category === 'settings' && target.route,
    );

    for (const target of settingsTargets) {
      const url = new URL(target.route!, 'app://intent');
      expect(url.searchParams.get('tab'), target.id).toBe(target.tab);
      expect(resolveHashToTarget(url.hash), target.id).toBeDefined();
      expect(isResolvableNavTarget(target.route), target.id).toBe(true);
    }
  });

  it('uses the canonical grouped settings tabs', () => {
    const expectedTabs = {
      providers: 'providers',
      integrations: 'connections',
      'mcp-servers': 'tools',
      'git-workspace': 'git-workspace',
      'cli-optimization': 'tools',
      'utility-default-model': 'tools',
      notifications: 'general',
      'open-in': 'general',
      'github-link-action': 'general',
      appearance: 'appearance',
      'color-theme': 'appearance',
      'note-font': 'appearance',
      'agent-chat-font': 'appearance',
      'code-font': 'appearance',
      general: 'advanced',
    } as const;

    const targets = getAppUiTargets();
    for (const [id, tab] of Object.entries(expectedTabs)) {
      expect(
        targets.find((target) => target.id === id),
        id,
      ).toMatchObject({ tab });
    }
  });

  it.each([
    '/settings?tab=accounts#providers',
    '/settings?tab=accounts#integrations',
    '/settings?tab=setup#mcp-servers',
    '/settings?tab=setup#git-workspace',
    '/settings?tab=setup#notifications',
    '/settings?tab=fonts-colors#theme',
    '/settings?tab=interface-system#color-theme',
  ])('keeps legacy settings URLs resolvable: %s', (route) => {
    expect(isResolvableNavTarget(route)).toBe(true);
  });

  it('preserves agents sub-view query parameters', () => {
    const targets = getAppUiTargets();

    expect(targets.find((target) => target.id === 'create-specialist')?.route).toBe(
      '/settings?tab=agents&view=create-specialist#create-specialist',
    );
    expect(targets.find((target) => target.id === 'specialist-entry')?.route).toBe(
      '/settings?tab=agents&specialist={specialistId}#specialist-{specialistId}',
    );
  });

  it('resolves the default-model hash to the canonical background agent target', () => {
    const target = resolveHashToTarget('default-model');

    expect(target).toMatchObject({
      id: 'quickActions.defaultModel',
      tab: 'agents',
      scrollSelector: '#default-model',
      highlightSelector: '[data-highlight-id="quickActions.defaultModel"]',
    });
  });

  // monorepo#1729: the hash is UI-only, so links minted before the
  // backgroundAgents.* → quickActions.* rename must keep resolving.
  it('still resolves the pre-rename backgroundAgents.defaultModel hash', () => {
    expect(resolveHashToTarget('backgroundAgents.defaultModel')).toMatchObject({
      id: 'quickActions.defaultModel',
    });
    expect(isResolvableNavTarget('/settings#backgroundAgents.defaultModel')).toBe(true);
  });

  it('returns undefined for an unknown hash', () => {
    expect(resolveHashToTarget('does-not-exist')).toBeUndefined();
  });

  it('falls back to the raw hash when no registry target exists for a route', () => {
    expect(getHighlightIdFromRoute('/settings#custom-target')).toBe('custom-target');
  });

});

describe('isResolvableNavTarget', () => {
  it('rejects the removed home route', () => {
    expect(isResolvableNavTarget('/')).toBe(false);
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
