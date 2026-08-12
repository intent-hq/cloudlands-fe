import { describe, expect, it } from 'vitest';
import {
  getPanelMovePreview,
  getPanelMovePreviewWidthRatio,
  getPanelRootEdgeMovePreview,
} from './panel-move-preview';

describe('getPanelMovePreview', () => {
  it('projects the same nested end state without mutating the live tree', () => {
    const root = {
      type: 'split' as const,
      direction: 'horizontal' as const,
      sizes: [40, 60],
      children: [
        { type: 'panel' as const, panelId: 'source' },
        { type: 'panel' as const, panelId: 'target' },
      ],
    };

    expect(getPanelMovePreview(root, 'source', 'target', 'above')).toEqual({
      type: 'split',
      direction: 'vertical',
      sizes: [50, 50],
      children: [
        { type: 'panel', panelId: 'source' },
        { type: 'panel', panelId: 'target' },
      ],
    });
    expect(root).toEqual({
      type: 'split',
      direction: 'horizontal',
      sizes: [40, 60],
      children: [
        { type: 'panel', panelId: 'source' },
        { type: 'panel', panelId: 'target' },
      ],
    });
  });

  it('promotes a nested panel into a true root-level left column', () => {
    const root = {
      type: 'split' as const,
      direction: 'horizontal' as const,
      sizes: [40, 60],
      children: [
        {
          type: 'split' as const,
          direction: 'vertical' as const,
          sizes: [50, 50],
          children: [
            { type: 'panel' as const, panelId: 'source' },
            { type: 'panel' as const, panelId: 'stack-mate' },
          ],
        },
        { type: 'panel' as const, panelId: 'right' },
      ],
    };

    const preview = getPanelRootEdgeMovePreview(root, 'source', 'before');
    expect(preview).toMatchObject({
      type: 'split',
      direction: 'horizontal',
      children: [
        { type: 'panel', panelId: 'source' },
        { type: 'panel', panelId: 'stack-mate' },
        { type: 'panel', panelId: 'right' },
      ],
    });
    expect(preview.type).toBe('split');
    if (preview.type === 'split') {
      expect(preview.sizes[0]).toBeCloseTo(100 / 3);
      expect(preview.sizes[1]).toBeCloseTo((40 * 2) / 3);
      expect(preview.sizes[2]).toBeCloseTo(40);
    }
    expect(getPanelMovePreviewWidthRatio(root, preview)).toBe(1.5);
    expect(root.children[0].type).toBe('split');
  });

  it('uses a default column share when promoting a stacked panel beside a target', () => {
    const root = {
      type: 'split' as const,
      direction: 'horizontal' as const,
      sizes: [40, 60],
      children: [
        {
          type: 'split' as const,
          direction: 'vertical' as const,
          sizes: [50, 50],
          children: [
            { type: 'panel' as const, panelId: 'source' },
            { type: 'panel' as const, panelId: 'stack-mate' },
          ],
        },
        { type: 'panel' as const, panelId: 'target' },
      ],
    };

    const preview = getPanelMovePreview(root, 'source', 'target', 'before');
    expect(preview.type).toBe('split');
    if (preview.type === 'split') {
      expect(preview.sizes[0]).toBeCloseTo((40 * 2) / 3);
      expect(preview.sizes[1]).toBeCloseTo(100 / 3);
      expect(preview.sizes[2]).toBeCloseTo(40);
    }
  });
});
