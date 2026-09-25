/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SettingsSidebarBack from './SettingsSidebarBack.svelte';

describe('SettingsSidebarBack', () => {
  afterEach(cleanup);

  it('invokes the existing back handler only when activated', async () => {
    const onBack = vi.fn();
    render(SettingsSidebarBack, { onBack });
    expect(onBack).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole('button', { name: /Back to app/ }));

    expect(onBack).toHaveBeenCalledExactlyOnceWith(expect.any(MouseEvent));
  });
});
