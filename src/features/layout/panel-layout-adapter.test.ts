import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ dispatch: vi.fn() }));

vi.mock('$store/renderer/store', () => ({
  store: { dispatch: mocks.dispatch, state: {} },
}));
vi.mock('$store/renderer/slices/panel-layout/panel-layout-selectors', () => ({
  selectFocusedPanelId: { select: vi.fn() },
  selectPanels: { select: vi.fn() },
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
  beforeEach(() => mocks.dispatch.mockClear());

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
});
