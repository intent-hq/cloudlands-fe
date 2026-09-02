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

  it('falls back to the rightmost configured column without panel focus', () => {
    new PanelLayoutAdapter('ws-1').openTab(tab);

    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'panelLayout/openTabInRightmostColumnRequested',
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

  it('routes browser content through canonical adjacent placement', () => {
    new PanelLayoutAdapter('ws-1').openBrowserPanel('https://example.com');

    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'panelLayout/openTabInAdjacentOrSplit',
        payload: expect.objectContaining({
          wsId: 'ws-1',
          sourcePanelId: undefined,
          tab: expect.objectContaining({ type: 'browser', browserUrl: 'https://example.com' }),
        }),
      }),
    );
  });

  it('keeps generic untargeted content in the rightmost panel when focus exists', () => {
    mocks.focusedPanelId = 'working';
    mocks.panels = { working: { id: 'working', tabs: [], activeTabId: null } };

    new PanelLayoutAdapter('ws-1').openTab(tab);

    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'panelLayout/openTabInRightmostColumnRequested',
        payload: expect.objectContaining({ wsId: 'ws-1', tab }),
      }),
    );
  });

  it('routes an empty source through canonical adjacent placement', () => {
    mocks.panels = { working: { id: 'working', tabs: [], activeTabId: null } };

    new PanelLayoutAdapter('ws-1').openTabInAdjacentOrSplit(tab, 'working');

    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'panelLayout/openTabInAdjacentOrSplit',
        payload: expect.objectContaining({ wsId: 'ws-1', sourcePanelId: 'working', tab }),
      }),
    );
  });

  it('forces untargeted user tabs into the focused panel', () => {
    mocks.focusedPanelId = 'working';

    new PanelLayoutAdapter('ws-1').openUserTab(tab);

    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'panelLayout/openTab',
        payload: expect.objectContaining({
          wsId: 'ws-1',
          panelId: 'working',
          tab,
          force: true,
        }),
      }),
    );
  });

  it('routes a populated source through canonical adjacent placement', () => {
    mocks.panels = {
      working: { id: 'working', tabs: [{ id: 'existing' }], activeTabId: 'existing' },
    };

    new PanelLayoutAdapter('ws-1').openTabInAdjacentOrSplit(tab, 'working');

    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'panelLayout/openTabInAdjacentOrSplit',
        payload: expect.objectContaining({ wsId: 'ws-1', sourcePanelId: 'working', tab }),
      }),
    );
  });

  it('preserves all adjacent placement options', () => {
    new PanelLayoutAdapter('ws-1').openTabInAdjacentOrSplit(tab, 'working', {
      animated: true,
      force: true,
      allowDuplicate: true,
    });

    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'panelLayout/openTabInAdjacentOrSplit',
        payload: expect.objectContaining({
          wsId: 'ws-1',
          sourcePanelId: 'working',
          tab,
          animated: true,
          force: true,
          allowDuplicate: true,
        }),
      }),
    );
  });

  it('routes a browser caller from a populated source through canonical adjacent placement', () => {
    mocks.panels = {
      working: { id: 'working', tabs: [{ id: 'existing' }], activeTabId: 'existing' },
    };

    new PanelLayoutAdapter('ws-1').openBrowserPanel(
      'https://example.com',
      'context-1',
      'working',
      'http://daemon.localhost:5173',
    );

    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'panelLayout/openTabInAdjacentOrSplit',
        payload: expect.objectContaining({
          wsId: 'ws-1',
          sourcePanelId: 'working',
          tab: expect.objectContaining({
            type: 'browser',
            browserUrl: 'https://example.com',
            browserRequestedUrl: 'http://daemon.localhost:5173',
            contextItemId: 'context-1',
          }),
        }),
      }),
    );
  });
});
