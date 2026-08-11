import { describe, expect, it, vi } from 'vitest';
import {
  animatePanelPreviewPositions,
  capturePanelPositions,
  translatePanel,
} from '../panel-reorder-animation';

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height } as DOMRect;
}

describe('translatePanel', () => {
  it('moves between differently sized slots without scaling panel contents', () => {
    const animation = translatePanel(
      document.createElement('div'),
      { from: rect(20, 10, 600, 800), to: rect(420, 10, 280, 800) },
      { duration: 180 },
    );
    const start = animation.css?.(0, 1) ?? '';
    const end = animation.css?.(1, 0) ?? '';

    expect(start).toContain('translate(-400px, 0px)');
    expect(end).toContain('translate(0px, 0px)');
    expect(start).not.toContain('scale');
    expect(animation.duration).toBe(180);
  });

  it('animates preview slots with translation only', () => {
    const root = document.createElement('div');
    const panel = document.createElement('div');
    panel.dataset.panelLayoutPreviewPanel = 'panel-1';
    panel.getBoundingClientRect = () => rect(420, 10, 280, 800);
    const cancel = vi.fn();
    const animate = vi.fn();
    Object.defineProperties(panel, {
      getAnimations: { value: () => [{ cancel }] },
      animate: { value: animate },
    });
    root.append(panel);

    animatePanelPreviewPositions(root, new Map([['panel-1', rect(20, 10, 600, 800)]]));

    expect(cancel).toHaveBeenCalledOnce();
    expect(animate).toHaveBeenCalledWith(
      [{ transform: 'translate3d(-400px, 0px, 0)' }, { transform: 'translate3d(0, 0, 0)' }],
      expect.objectContaining({ duration: 240 }),
    );
    expect(JSON.stringify(animate.mock.calls)).not.toContain('scale');
  });

  it('captures positions by stable panel id', () => {
    const root = document.createElement('div');
    const panel = document.createElement('div');
    panel.dataset.panelId = 'panel-1';
    panel.getBoundingClientRect = () => rect(12, 34, 500, 600);
    root.append(panel);

    expect(capturePanelPositions(root, '[data-panel-id]').get('panel-1')?.left).toBe(12);
  });
});
