/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import PanelDragPreview from '../PanelDragPreview.svelte';

function addSourcePanel(panelId: string, text: string): HTMLElement {
  const panel = document.createElement('section');
  panel.dataset.panelId = panelId;
  panel.className = 'actual-panel-shell';
  panel.innerHTML = `<input value="initial"><span>${text}</span>`;
  const input = panel.querySelector('input');
  if (input) input.value = `${text} state`;
  document.body.append(panel);
  return panel;
}

afterEach(() => cleanup());

describe('PanelDragPreview', () => {
  it('lets the outer workspace own projected width without shrinking the preview twice', () => {
    const layout = readFileSync(
      resolve(process.cwd(), 'src/lib/components/layout/panel-system/PanelLayout.svelte'),
      'utf8',
    );

    expect(layout).toContain('contained && !onPanelMovePreviewWidthRatioChange');
    expect(layout).toContain('onPanelMovePreviewWidthRatioChange?.(nextRatio)');
  });

  it('renders the projected tree from inert snapshots without retaining the old layout', () => {
    const source = addSourcePanel('source-panel', 'Source content');
    const target = addSourcePanel('target-panel', 'Target content');
    const { container } = render(PanelDragPreview, {
      props: {
        draggedPanelId: 'source-panel',
        node: {
          type: 'split',
          direction: 'vertical',
          sizes: [50, 50],
          children: [
            { type: 'panel', panelId: 'source-panel' },
            { type: 'panel', panelId: 'target-panel' },
          ],
        },
      },
    });

    expect(container.querySelector('[data-panel-layout-preview-split="vertical"]')).toBeTruthy();
    expect(container.querySelector('.panel-drag-preview-split')).toBeTruthy();
    const snapshots = [
      ...container.querySelectorAll<HTMLElement>('[data-panel-layout-preview-snapshot]'),
    ];
    expect(snapshots.map((snapshot) => snapshot.textContent)).toEqual([
      'Source content',
      'Target content',
    ]);
    expect(snapshots.map((snapshot) => snapshot.dataset.panelLayoutPreviewSnapshot)).toEqual([
      'source-panel',
      'target-panel',
    ]);
    expect(container.querySelector('[data-panel-id]')).toBeNull();
    expect(snapshots.every((snapshot) => snapshot.inert)).toBe(true);
    expect(snapshots[0].querySelector('input')?.value).toBe('Source content state');
    expect(snapshots[0].style.animation).toBe('none');
    const draggedPreview = container.querySelector<HTMLElement>(
      '[data-panel-layout-preview-dragged]',
    );
    expect(draggedPreview).toBe(snapshots[0].parentElement?.parentElement);
    expect(draggedPreview?.children).toHaveLength(1);
    expect(container.querySelector('[data-panel-layout-preview-drag-emphasis]')).toBeNull();
    expect(
      [...(draggedPreview?.classList ?? [])].some(
        (className) => className.startsWith('border') || className.startsWith('bg-'),
      ),
    ).toBe(false);

    source.remove();
    target.remove();
  });
});
