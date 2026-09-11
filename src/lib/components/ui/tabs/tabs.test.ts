// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { collapsiblePanelProductMetadata } from '../CollapsiblePanel.meta';
import { parseUiComponentMetadata } from '../component-metadata';
import { smartCornerTabsProductMetadata } from '../smart-corner-tabs/smart-corner-tabs.meta';
import TabsHarness from './TabsHarness.svelte';
import { createTabsIndicatorSprings, retargetTabsIndicator } from './tabs-indicator-motion.svelte';
import { tabsMetadata } from './tabs.meta';

afterEach(cleanup);

describe('Tabs', () => {
  it('selects panels and supports automatic keyboard navigation', async () => {
    const { getByRole, queryByText } = render(TabsHarness);
    const overview = getByRole('tab', { name: 'Overview' });
    const activity = getByRole('tab', { name: 'Activity' });
    expect(overview.getAttribute('aria-selected')).toBe('true');
    expect(queryByText('Overview panel')).not.toBeNull();

    overview.focus();
    await fireEvent.keyDown(overview, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(activity);
    expect(activity.getAttribute('aria-selected')).toBe('true');
    expect(queryByText('Activity panel')).not.toBeNull();
  });

  it('retargets one moderate indicator spring while it is in flight', () => {
    const springs = createTabsIndicatorSprings({ top: 0, left: 0, width: 80, height: 36 });
    expect(retargetTabsIndicator(springs, { top: 0, left: 84, width: 72, height: 36 })).toBe(
      springs,
    );
    expect(springs.left.target).toBe(84);
    expect(retargetTabsIndicator(springs, { top: 0, left: 160, width: 96, height: 36 })).toBe(
      springs,
    );
    expect(springs.left.target).toBe(160);
  });

  it('uses text-only subtle tabs and inherits compact size', () => {
    const { getByRole } = render(TabsHarness, { props: { subtle: true, compact: true } });
    const overview = getByRole('tab', { name: 'Overview' });
    expect(overview.dataset.variant).toBe('subtle');
    expect(overview.dataset.size).toBe('compact');
    expect(document.querySelector('[data-tabs-indicator]')).toBeNull();
  });

  it.each([
    {
      compact: false,
      subtle: false,
      listPadding: null,
      triggerHeight: 'h-(--control-height-medium)',
      outerHeight: 36,
    },
    {
      compact: true,
      subtle: false,
      listPadding: null,
      triggerHeight: 'h-(--control-height-compact)',
      outerHeight: 28,
    },
    {
      compact: false,
      subtle: true,
      listPadding: 'px-1',
      triggerHeight: 'h-(--control-height-medium)',
      outerHeight: 36,
    },
    {
      compact: true,
      subtle: true,
      listPadding: 'px-1',
      triggerHeight: 'h-(--control-height-compact)',
      outerHeight: 28,
    },
  ])(
    'composes the $outerHeight px outer size from the trigger and list padding',
    ({ compact, subtle, listPadding, triggerHeight }) => {
      const { getByRole } = render(TabsHarness, { props: { compact, subtle } });
      const list = getByRole('tablist', { name: 'Project sections' });
      const overview = getByRole('tab', { name: 'Overview' });

      if (listPadding) expect(list.className).toContain(listPadding);
      else {
        const hasNonHorizontalPadding = list.className
          .split(/\s+/)
          .some((className) => className.startsWith('p-') && !className.startsWith('px-'));
        expect(hasNonHorizontalPadding).toBe(false);
      }
      expect(overview.className).toContain(triggerHeight);
      expect(overview.className).toContain('border-0');
      expect(overview.className).toContain('rounded-(--radius-medium)');
      expect(overview.className).toContain('px-3');
      expect(overview.className).toContain('gap-1.5');
    },
  );

  it('publishes catalog metadata and product replacement paths', () => {
    expect(() => parseUiComponentMetadata(tabsMetadata)).not.toThrow();
    expect(() => parseUiComponentMetadata(smartCornerTabsProductMetadata)).not.toThrow();
    expect(() => parseUiComponentMetadata(collapsiblePanelProductMetadata)).not.toThrow();
    expect(tabsMetadata.fixtures[0].states).toEqual(expect.arrayContaining(['subtle', 'compact']));
    expect([
      smartCornerTabsProductMetadata.replacement,
      collapsiblePanelProductMetadata.replacement,
    ]).toEqual(['$lib/components/ui/tabs', '$lib/components/ui/accordion']);
  });
});
