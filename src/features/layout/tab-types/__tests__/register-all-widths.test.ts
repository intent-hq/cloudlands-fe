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

import { registerAllTabTypes } from '../register-all';
import { tabTypeRegistry } from '../registry';

const expectedTiers = {
  agent: 'narrow',
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

  it('resolves chat narrow, notes medium, and browsers wide', () => {
    registerAllTabTypes();
    expect(tabTypeRegistry.getDefaultWidth('agent', 1200)).toBe(500);
    expect(tabTypeRegistry.getDefaultWidth('note', 1200)).toBe(720);
    expect(tabTypeRegistry.getDefaultWidth('browser', 1200)).toBe(960);
  });
});
