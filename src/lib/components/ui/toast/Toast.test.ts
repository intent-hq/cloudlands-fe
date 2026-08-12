import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'svelte-sonner';
import Toast from './Toast.svelte';

vi.mock('$store/renderer/slices/theme/theme-selectors', () => ({
  selectIsDarkTheme: () => ({
    subscribe: (run: (value: boolean) => void) => {
      run(false);
      return () => undefined;
    },
  }),
}));

describe('Toast', () => {
  afterEach(() => {
    toast.dismiss();
    cleanup();
  });

  it('renders a success toast without entering a reactive update loop', async () => {
    render(Toast);

    toast.success('Saved successfully');

    expect(await screen.findByText('Saved successfully')).toBeTruthy();
  });
});
