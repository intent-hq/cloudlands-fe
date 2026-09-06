import { describe, expect, it, vi } from 'vitest';
import type { PanelTabType } from '$store/renderer/slices/panel-layout/panel-layout-types';
import type { PanelDefaultWidthTier } from '$shared/panel-layout-sizing';

const mockTabType = vi.hoisted(() => async () => ({ default: {} }));

vi.mock('../BrowserTabType.svelte', mockTabType);
vi.mock('../TerminalTabType.svelte', mockTabType);
vi.mock('../CodeReviewTabType.svelte', mockTabType);
vi.mock('../AgentOverviewTabType.svelte', mockTabType);
vi.mock('../AgentTabType.svelte', mockTabType);
vi.mock('../NoteTabType.svelte', mockTabType);
vi.mock('../FileTabType.svelte', mockTabType);
vi.mock('../DiffTabType.svelte', mockTabType);
vi.mock('../ChangesTabType.svelte', mockTabType);
vi.mock('../LocalChangesTabType.svelte', mockTabType);
vi.mock('../ChatChangesTabType.svelte', mockTabType);
vi.mock('../ActivityChangesTabType.svelte', mockTabType);
vi.mock('../HookScriptTabType.svelte', mockTabType);
vi.mock('../SettingsTabType.svelte', mockTabType);
vi.mock('../OverviewTabType.svelte', mockTabType);
vi.mock('../MapTabType.svelte', mockTabType);

import { preloadRestoredTabTypes, registerAllTabTypes } from '../register-all';
import { tabTypeRegistry } from '../registry';
import { RESOURCE_ICON_BY_KIND } from '$lib/components/shared/resource-icon';

const expectedTiers = {
  agent: 'chat',
  'agent-overview': 'narrow',
  'activity-changes': 'wide',
  browser: 'wide',
  changes: 'wide',
  'chat-changes': 'wide',
  'code-review': 'wide',
  diff: 'wide',
  file: 'wide',
  'hook-script': 'medium',
  'local-changes': 'wide',
  map: 'wide',
  note: 'medium',
  overview: 'narrow',
  settings: 'narrow',
  terminal: 'medium',
} satisfies Partial<Record<PanelTabType, PanelDefaultWidthTier>>;

describe('registered panel default width tiers', () => {
  it('requires an intentional tier for every panel type', () => {
    registerAllTabTypes();
    expect(
      Object.fromEntries(
        tabTypeRegistry.getAll().map(({ type, defaultWidthTier }) => [type, defaultWidthTier]),
      ),
    ).toEqual(expectedTiers);
  });

  it('resolves chat, notes, and browsers through their canonical tiers', () => {
    registerAllTabTypes();
    expect(tabTypeRegistry.getDefaultWidth('agent', 1200)).toBe(700);
    expect(tabTypeRegistry.getDefaultWidth('note', 1200)).toBe(720);
    expect(tabTypeRegistry.getDefaultWidth('browser', 1200)).toBe(960);
  });

  it('uses one note icon and one changes icon for every alias', () => {
    registerAllTabTypes();

    expect(tabTypeRegistry.getIcon('note')).toBe(RESOURCE_ICON_BY_KIND.note);
    for (const type of ['changes', 'local-changes', 'chat-changes', 'activity-changes']) {
      expect(tabTypeRegistry.getIcon(type)).toBe(RESOURCE_ICON_BY_KIND.changes);
    }
  });

  it('preloads only active tabs from a restored layout', async () => {
    registerAllTabTypes();
    await preloadRestoredTabTypes({
      restoreStatus: 'restored',
      panels: {
        first: {
          id: 'first',
          activeTabId: 'terminal-tab',
          tabs: [
            { id: 'terminal-tab', type: 'terminal', title: 'Terminal', closable: true },
            { id: 'file-tab', type: 'file', title: 'File', closable: true },
          ],
        },
      },
    });

    expect(tabTypeRegistry.getLoadedComponent('terminal')).toBeDefined();
    expect(tabTypeRegistry.getLoadedComponent('file')).toBeUndefined();
  });
});
