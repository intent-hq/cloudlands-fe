import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  focusedPanelId: undefined as string | undefined,
  panels: {} as Record<string, { id: string; tabs: unknown[]; activeTabId: string | null }>,
}));

vi.mock('$store/renderer/store', () => ({
  store: { dispatch: mocks.dispatch, state: {} },
}));
vi.mock('$store/renderer/slices/panel-layout/panel-layout-selectors', () => ({
  selectFocusedPanelId: { select: () => mocks.focusedPanelId },
  selectPanels: { select: () => mocks.panels },
  selectAllTabs: { select: vi.fn() },
  selectPanelIds: { select: vi.fn() },
  selectPanel: { select: vi.fn() },
}));

import { PanelLayoutAdapter } from './panel-layout-adapter';

const tab = {
  type: 'note' as const,
  title: 'Plan',
  noteId: 'spec',
  closable: true,
};

describe('PanelLayoutAdapter', () => {
  beforeEach(() => {
    mocks.dispatch.mockClear();
    mocks.focusedPanelId = undefined;
    mocks.panels = {};
  });

  it('routes untargeted content through the global panel mode', () => {
    new PanelLayoutAdapter('ws-1').openTab(tab);

    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'panelLayout/openTabWithPanelModeRequested',
        payload: expect.objectContaining({ wsId: 'ws-1', tab }),
      }),
    );
  });

  it('keeps explicit panel placement for presets and layout orchestration', () => {
    new PanelLayoutAdapter('ws-1').openTab(tab, 'panel-2');

    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'panelLayout/openTab',
        payload: expect.objectContaining({ wsId: 'ws-1', panelId: 'panel-2', tab }),
      }),
    );
  });

  it('routes browser content through the global panel mode', () => {
    new PanelLayoutAdapter('ws-1').openBrowserPanel('https://example.com');

    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'panelLayout/openTabWithPanelModeRequested',
        payload: expect.objectContaining({
          wsId: 'ws-1',
          tab: expect.objectContaining({ type: 'browser', browserUrl: 'https://example.com' }),
        }),
      }),
    );
  });

  it('opens untargeted content in the focused empty panel', () => {
    mocks.focusedPanelId = 'working';
    mocks.panels = { working: { id: 'working', tabs: [], activeTabId: null } };

    new PanelLayoutAdapter('ws-1').openTab(tab);

    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'panelLayout/openTab',
        payload: expect.objectContaining({ panelId: 'working', tab }),
      }),
    );
  });

  it('opens adjacent content in its empty source panel', () => {
    mocks.panels = { working: { id: 'working', tabs: [], activeTabId: null } };

    new PanelLayoutAdapter('ws-1').openTabInAdjacentOrSplit(tab, 'working');

    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'panelLayout/openTab',
        payload: expect.objectContaining({ panelId: 'working', tab }),
      }),
    );
  });
});
