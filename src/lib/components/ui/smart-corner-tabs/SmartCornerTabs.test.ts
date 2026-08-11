/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SmartCornerTabs from './SmartCornerTabs.svelte';

const tabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'changes', label: 'Changes and review' },
  { id: 'activity', label: 'Activity' },
  { id: 'settings', label: 'Settings' },
];

describe('SmartCornerTabs', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({
        matches: true,
        addEventListener() {},
        removeEventListener() {},
      }),
    });
  });

  it('renders accessible tabs, a panel, and a non-interactive SVG surface', () => {
    render(SmartCornerTabs, { props: { tabs, ariaLabel: 'Demo tabs' } });

    expect(screen.getByRole('tablist', { name: 'Demo tabs' })).toBeTruthy();
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByRole('tabpanel')).toBeTruthy();
    expect(
      document
        .querySelector('[data-smart-corner-tabs] svg')
        ?.classList.contains('pointer-events-none'),
    ).toBe(true);
  });

  it('uses roving tab focus and activates with arrow, home, and end keys', async () => {
    const onTabChange = vi.fn();
    render(SmartCornerTabs, { props: { tabs, onTabChange } });
    const overview = screen.getByRole('tab', { name: 'Overview' });

    await fireEvent.keyDown(overview, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Changes and review' }).getAttribute('tabindex')).toBe(
      '0',
    );
    expect(onTabChange).toHaveBeenCalledWith('changes');

    await fireEvent.keyDown(screen.getByRole('tab', { name: 'Changes and review' }), {
      key: 'End',
    });
    expect(screen.getByRole('tab', { name: 'Settings' }).getAttribute('tabindex')).toBe('0');
    expect(onTabChange).toHaveBeenCalledWith('settings');

    await fireEvent.keyDown(screen.getByRole('tab', { name: 'Settings' }), { key: 'Home' });
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('tabindex')).toBe('0');
    expect(onTabChange).toHaveBeenCalledWith('overview');
  });
});
