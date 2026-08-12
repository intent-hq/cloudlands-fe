import { describe, expect, it, vi } from 'vitest';
import { closePanelWithLastPanelPolicy } from '../close-panel';

function createLayout(panelIds: string[]) {
  return {
    getPanelIds: vi.fn(() => panelIds),
    closePanel: vi.fn(),
    clearLayout: vi.fn(),
  };
}

describe('closePanelWithLastPanelPolicy', () => {
  it('clears an isolated layout when its final panel closes', () => {
    const layout = createLayout(['panel-1']);

    closePanelWithLastPanelPolicy(layout, 'panel-1', true);

    expect(layout.clearLayout).toHaveBeenCalledOnce();
    expect(layout.closePanel).not.toHaveBeenCalled();
  });

  it('uses normal panel closing when other panels remain', () => {
    const layout = createLayout(['panel-1', 'panel-2']);

    closePanelWithLastPanelPolicy(layout, 'panel-2', true);

    expect(layout.closePanel).toHaveBeenCalledWith('panel-2');
    expect(layout.clearLayout).not.toHaveBeenCalled();
  });

  it('preserves the shared last-panel guard outside isolated layouts', () => {
    const layout = createLayout(['panel-1']);

    closePanelWithLastPanelPolicy(layout, 'panel-1', false);

    expect(layout.closePanel).toHaveBeenCalledWith('panel-1');
    expect(layout.clearLayout).not.toHaveBeenCalled();
  });
});
