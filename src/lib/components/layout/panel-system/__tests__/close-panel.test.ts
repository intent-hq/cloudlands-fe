import { describe, expect, it, vi } from 'vitest';
import { closePanelWithLastPanelPolicy } from '../close-panel';

function createLayout(panelIds: string[]) {
  return {
    getPanelIds: vi.fn(() => panelIds),
    closePanel: vi.fn(),
    closeAllTabs: vi.fn(),
    clearLayout: vi.fn(),
  };
}

describe('closePanelWithLastPanelPolicy', () => {
  it('clears an isolated layout when its final panel closes', () => {
    const layout = createLayout(['panel-1']);

    closePanelWithLastPanelPolicy(layout, 'panel-1', true);

    expect(layout.clearLayout).toHaveBeenCalledOnce();
    expect(layout.closePanel).not.toHaveBeenCalled();
    expect(layout.closeAllTabs).not.toHaveBeenCalled();
  });

  it('uses normal panel closing when other panels remain', () => {
    const layout = createLayout(['panel-1', 'panel-2']);

    closePanelWithLastPanelPolicy(layout, 'panel-2', true);

    expect(layout.closePanel).toHaveBeenCalledWith('panel-2');
    expect(layout.closeAllTabs).not.toHaveBeenCalled();
    expect(layout.clearLayout).not.toHaveBeenCalled();
  });

  it('closes the final panel content outside isolated layouts', () => {
    const layout = createLayout(['panel-1']);

    closePanelWithLastPanelPolicy(layout, 'panel-1', false);

    expect(layout.closeAllTabs).toHaveBeenCalledWith('panel-1');
    expect(layout.closePanel).not.toHaveBeenCalled();
    expect(layout.clearLayout).not.toHaveBeenCalled();
  });
});
