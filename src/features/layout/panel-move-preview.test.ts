import { describe, expect, it } from 'vitest';
import {
  getPaneDropPreview,
  getPanelMovePreview,
  getPanelMovePreviewWidthRatio,
  getPanelRootEdgeMovePreview,
  PANE_DROP_PREVIEW_PANEL_ID,
} from './panel-move-preview';
import type { PaneDropPlacement } from '$lib/components/layout/panel-system/panel-drag';

const fixedRoot = {
  type: 'split' as const,
  direction: 'horizontal' as const,
  sizes: [50, 50],
  children: [
    { type: 'panel' as const, panelId: 'left' },
    { type: 'panel' as const, panelId: 'right' },
  ],
};

function panelOrder(root: ReturnType<typeof getPaneDropPreview>): string[] {
  return root.type === 'split'
    ? root.children.flatMap((child) => (child.type === 'panel' ? [child.panelId] : []))
    : [root.panelId];
}

describe('getPaneDropPreview', () => {
  it.each<[string, PaneDropPlacement, string[]]>([
    [
      'outer left edge',
      { kind: 'edge', position: 'before' },
      [PANE_DROP_PREVIEW_PANEL_ID, 'left', 'right'],
    ],
    [
      'outer right edge',
      { kind: 'edge', position: 'after' },
      ['left', 'right', PANE_DROP_PREVIEW_PANEL_ID],
    ],
    [
      'interior boundary',
      { kind: 'panel', targetPanelId: 'right', zone: 'left' },
      ['left', PANE_DROP_PREVIEW_PANEL_ID, 'right'],
    ],
    [
      'panel left side',
      { kind: 'panel', targetPanelId: 'left', zone: 'left' },
      [PANE_DROP_PREVIEW_PANEL_ID, 'left', 'right'],
    ],
    [
      'panel right side',
      { kind: 'panel', targetPanelId: 'left', zone: 'right' },
      ['left', PANE_DROP_PREVIEW_PANEL_ID, 'right'],
    ],
  ])('projects the exact new-column destination for the %s', (_, placement, expected) => {
    const preview = getPaneDropPreview(fixedRoot, placement, 800);

    expect(panelOrder(preview)).toEqual(expected);
    expect(getPanelMovePreviewWidthRatio(fixedRoot, preview)).toBe(1.5);
    expect(panelOrder(fixedRoot)).toEqual(['left', 'right']);
  });

  it('keeps the layout shape for a center-to-stack destination', () => {
    const preview = getPaneDropPreview(
      fixedRoot,
      { kind: 'panel', targetPanelId: 'right', zone: 'center' },
      800,
    );

    expect(preview).toBe(fixedRoot);
    expect(getPanelMovePreviewWidthRatio(fixedRoot, preview)).toBe(1);
  });

  it('does not project a fifth column', () => {
    const fourColumns = {
      ...fixedRoot,
      sizes: [25, 25, 25, 25],
      children: ['one', 'two', 'three', 'four'].map((panelId) => ({
        type: 'panel' as const,
        panelId,
      })),
    };

    expect(getPaneDropPreview(fourColumns, { kind: 'edge', position: 'after' }, 1200)).toBe(
      fourColumns,
    );
  });
});

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
