/**
 * @vitest-environment jsdom
 *
 * Root '/' home page — renders the no-space-selected empty state and its
 * button dispatches setShowCreateModal(true) to open the New Space modal.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import { setShowCreateModal } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import HomePage from './+page.svelte';

const reduxDispatchMock = vi.hoisted(() => vi.fn());
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import(
    '$store/renderer/utils/test-helpers/store-mock'
  );
  return createAppStoreMockModule({ dispatch: reduxDispatchMock });
});

describe('root home page', () => {
  afterEach(() => {
    cleanup();
    reduxDispatchMock.mockClear();
  });

  it('renders the empty state', () => {
    const { container } = render(HomePage);
    expect(container.textContent).toContain('No space selected');
  });

  it('opens the New Space modal from the button', async () => {
    render(HomePage);
    await fireEvent.click(screen.getByRole('button', { name: 'New Space' }));
    expect(reduxDispatchMock).toHaveBeenCalledWith(setShowCreateModal(true));
  });
});
