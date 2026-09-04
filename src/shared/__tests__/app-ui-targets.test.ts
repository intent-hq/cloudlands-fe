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
      voice: 'input',
      'keyboard-shortcuts': 'input',
      'mcp-servers': 'connections',
      'git-workspace': 'setup',
      git: 'setup',
      shell: 'setup',
      workspace: 'setup',
      'cli-optimization': 'setup',
      'workspace-api': 'advanced',
      'utility-default-model': 'providers',
      notifications: 'app-behavior',
      updates: 'app-behavior',
      'open-in': 'app-behavior',
      'github-link-action': 'app-behavior',
      'agent-features': 'agent-behavior',
      'global-instructions': 'agent-behavior',
      'quickActions.defaultModel': 'providers',
      appearance: 'display',
      'font-style': 'display',
      language: 'display',
      'color-theme': 'display',
      'note-font': 'display',
      'agent-chat-font': 'display',
      'code-font': 'display',
      general: 'advanced',
      devices: 'devices',
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
    '/settings?tab=connections#voice',
    '/settings?tab=system#workspace-api',
    '/settings?tab=agents#default-model',
  ])('keeps legacy settings URLs resolvable: %s', (route) => {
    expect(isResolvableNavTarget(route)).toBe(true);
  });

  it('preserves specialist sub-view query parameters', () => {
    const targets = getAppUiTargets();

    expect(targets.find((target) => target.id === 'create-specialist')?.route).toBe(
      '/settings?tab=specialists&view=create-specialist#create-specialist',
    );
    expect(targets.find((target) => target.id === 'specialist-entry')?.route).toBe(
      '/settings?tab=specialists&specialist={specialistId}#specialist-{specialistId}',
    );
  });

  it('resolves dynamic specialist hashes to the Specialists target', () => {
    const route = '/settings?tab=specialists&specialist=implementor#specialist-implementor';

    expect(resolveHashToTarget('specialist-implementor')).toMatchObject({
      id: 'specialist-implementor',
      tab: 'specialists',
      category: 'specialist',
      dynamic: true,
    });
    expect(getHighlightIdFromRoute(route)).toBe('specialist-implementor');
    expect(isResolvableNavTarget(route)).toBe(true);
  });

  it('resolves the default-model hash to the Providers default model target', () => {
    const target = resolveHashToTarget('default-model');

    expect(target).toMatchObject({
      id: 'quickActions.defaultModel',
      tab: 'providers',
      scrollSelector: '#utility-default-model',
      highlightSelector: '[data-highlight-id="utility-default-model"]',
      route: '/settings?tab=providers#utility-default-model',
    });
  });

  it('resolves agent-behavior hashes to the Global Instructions target', () => {
    for (const hash of ['global-instructions', 'agents', 'specialists', 'all-agents']) {
      expect(resolveHashToTarget(hash), hash).toMatchObject({
        id: 'global-instructions',
        tab: 'agent-behavior',
        scrollSelector: '#global-instructions',
        highlightSelector: '[data-highlight-id="global-instructions"]',
      });
    }
    expect(getHighlightIdFromRoute('/settings?tab=agent-behavior#global-instructions')).toBe(
      'global-instructions',
    );
  });

  // monorepo#1729: the hash is UI-only, so links minted before the
  // backgroundAgents.* → quickActions.* rename must keep resolving.
  it('still resolves the pre-rename backgroundAgents.defaultModel hash', () => {
    expect(resolveHashToTarget('backgroundAgents.defaultModel')).toMatchObject({
      id: 'quickActions.defaultModel',
    });
    expect(isResolvableNavTarget('/settings#backgroundAgents.defaultModel')).toBe(true);
  });

  it('resolves the legacy machines hash to the canonical Devices target', () => {
    expect(resolveHashToTarget('machines')).toMatchObject({ id: 'devices', tab: 'devices' });
    expect(isResolvableNavTarget('/settings?tab=machines#machines')).toBe(true);
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
