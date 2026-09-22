/** @vitest-environment jsdom */
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ContentSkeleton from './ContentSkeleton.svelte';
import SidebarSkeleton from './SidebarSkeleton.svelte';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('workspace loading skeletons', () => {
  it('uses one quiet shimmer layer on sidebar-relative placeholders', () => {
    const { container } = render(SidebarSkeleton);
    const wrapper = container.querySelector('[data-workspace-sidebar-skeleton]');
    const placeholders = [...container.querySelectorAll('[data-slot="skeleton"]')];

    expect(wrapper?.classList.contains('animate-pulse')).toBe(false);
    expect(placeholders.length).toBeGreaterThan(0);
    expect(
      placeholders.every(
        (placeholder) =>
          placeholder.classList.contains('skeleton-shimmer') &&
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

  it('does not compound the content skeleton shimmer animation', () => {
    const { container } = render(ContentSkeleton);
    const wrapper = container.querySelector('[data-workspace-content-skeleton]');

    expect(wrapper?.classList.contains('animate-pulse')).toBe(false);
    expect(wrapper?.classList).toContain('bg-sidebar');
    expect(wrapper?.classList).not.toContain('bg-transparent');
    expect(container.querySelector('[data-slot="skeleton"]')?.classList).toContain(
      'skeleton-shimmer',
    );
  });

  it.each([
    ['content', ContentSkeleton, '[data-workspace-content-skeleton]'],
    ['sidebar', SidebarSkeleton, '[data-workspace-sidebar-skeleton]'],
  ] as const)(
    'mounts the %s skeleton opaque instead of fading in over mounted content',
    async (_, Skeleton, selector) => {
      // Svelte drives every intro transition (fade/fly/...) through the Web
      // Animations API, so a skeleton that fades in animates its root here.
      // Intros are queued as effects, so flush them before asserting.
      const animate = vi.spyOn(Element.prototype, 'animate');

      const { container } = render(Skeleton);
      await tick();
      const wrapper = container.querySelector<HTMLElement>(selector)!;

      expect(wrapper).toBeTruthy();
      expect(animate).not.toHaveBeenCalled();
      expect(wrapper.style.opacity).toBe('');
    },
  );

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
