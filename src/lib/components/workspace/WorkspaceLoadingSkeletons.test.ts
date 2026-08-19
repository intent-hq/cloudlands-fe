/** @vitest-environment jsdom */
import { render } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import ContentSkeleton from './ContentSkeleton.svelte';
import SidebarSkeleton from './SidebarSkeleton.svelte';

describe('workspace loading skeletons', () => {
  it('uses one quiet pulse layer on sidebar-relative placeholders', () => {
    const { container } = render(SidebarSkeleton);
    const wrapper = container.querySelector('[data-workspace-sidebar-skeleton]');
    const placeholders = [...container.querySelectorAll('[data-slot="skeleton"]')];

    expect(wrapper?.classList.contains('animate-pulse')).toBe(false);
    expect(placeholders.length).toBeGreaterThan(0);
    expect(
      placeholders.every(
        (placeholder) =>
          placeholder.classList.contains('animate-pulse') &&
          placeholder.classList.contains('bg-sidebar-foreground/10'),
      ),
    ).toBe(true);
  });

  it('uses the final sidebar surface and launcher-card structure while loading', () => {
    const { container } = render(SidebarSkeleton);
    const wrapper = container.querySelector('[data-workspace-sidebar-skeleton]');

    expect(wrapper?.classList).toContain('bg-sidebar');
    expect(wrapper?.classList).toContain('text-sidebar-foreground');
    expect(container.querySelector('[data-loading-workspace-header]')).toBeTruthy();
    expect(container.querySelector('[data-loading-workspace-activity]')).toBeTruthy();
    expect(container.querySelectorAll('[data-loading-sidebar-card]')).toHaveLength(6);
  });

  it('does not compound the content skeleton pulse animation', () => {
    const { container } = render(ContentSkeleton);
    const wrapper = container.querySelector('[data-workspace-content-skeleton]');

    expect(wrapper?.classList.contains('animate-pulse')).toBe(false);
    expect(wrapper?.classList).toContain('bg-sidebar');
    expect(wrapper?.classList).not.toContain('bg-transparent');
    expect(container.querySelector('[data-slot="skeleton"]')?.classList).toContain('animate-pulse');
  });

  it('keeps loading surfaces opaque instead of fading over mounted content', () => {
    const contentSource = readFileSync(
      resolve(process.cwd(), 'src/lib/components/workspace/ContentSkeleton.svelte'),
      'utf8',
    );
    const sidebarSource = readFileSync(
      resolve(process.cwd(), 'src/lib/components/workspace/SidebarSkeleton.svelte'),
      'utf8',
    );

    expect(contentSource).not.toContain('in:fade');
    expect(sidebarSource).not.toContain('in:fade');
  });

  it('matches the reserved panel-column geometry and final panel surface', () => {
    const { container } = render(ContentSkeleton, { props: { panelCount: 3 } });
    const loadingPanels = [...container.querySelectorAll('[data-loading-panel]')];

    expect(
      container
        .querySelector('[data-workspace-content-skeleton]')
        ?.getAttribute('data-panel-count'),
    ).toBe('3');
    expect(loadingPanels).toHaveLength(3);
    expect(
      loadingPanels.every(
        (panel) =>
          panel.classList.contains('rounded-lg') &&
          panel.classList.contains('border-border') &&
          panel.classList.contains('bg-card') &&
          panel.classList.contains('text-card-foreground') &&
          ![...panel.classList].some((className) => className.startsWith('shadow-')),
      ),
    ).toBe(true);
  });

  it('reproduces restored horizontal and vertical split sizes while loading', () => {
    const { container } = render(ContentSkeleton, {
      props: {
        layoutRoot: {
          type: 'split',
          direction: 'horizontal',
          sizes: [40, 60],
          children: [
            { type: 'panel', panelId: 'left' },
            {
              type: 'split',
              direction: 'vertical',
              sizes: [35, 65],
              children: [
                { type: 'panel', panelId: 'top-right' },
                { type: 'panel', panelId: 'bottom-right' },
              ],
            },
          ],
        },
      },
    });

    const horizontal = container.querySelector('[data-loading-split="horizontal"]');
    const vertical = container.querySelector('[data-loading-split="vertical"]');
    expect(container.querySelectorAll('[data-loading-panel]')).toHaveLength(3);
    expect(horizontal?.children[0]?.getAttribute('style')).toContain('flex: 40 1 0%');
    expect(horizontal?.children[1]?.getAttribute('style')).toContain('flex: 60 1 0%');
    expect(vertical?.children[0]?.getAttribute('style')).toContain('flex: 35 1 0%');
    expect(vertical?.children[1]?.getAttribute('style')).toContain('flex: 65 1 0%');
  });
});
