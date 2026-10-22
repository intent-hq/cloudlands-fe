/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { goto } from '$app/navigation';
import { store as appStore } from '$store/renderer/store';
import { setOnboardingActive } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import SidebarNavHarness from './__tests__/mocks/SidebarNavHarness.svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/workspace/example') } }));

describe('Home navigation', () => {
  afterEach(() => vi.clearAllMocks());

  it.each([1, 0])('opens Home once for pointer or keyboard activation (%s)', async (detail) => {
    render(SidebarNavHarness);
    appStore.dispatch(setOnboardingActive(false));
    await fireEvent.click(screen.getByRole('button', { name: 'Home' }), { detail });
    expect(goto).toHaveBeenCalledExactlyOnceWith('/');
  });

  it('does not navigate on hover or context menu', async () => {
    render(SidebarNavHarness);
    appStore.dispatch(setOnboardingActive(false));
    const control = screen.getByRole('button', { name: 'Home' });
    await fireEvent.mouseEnter(control);
    await fireEvent.contextMenu(control);
    expect(goto).not.toHaveBeenCalled();
  });
});
