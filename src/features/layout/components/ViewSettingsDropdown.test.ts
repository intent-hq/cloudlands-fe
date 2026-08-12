import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ViewSettingsDropdown from './ViewSettingsDropdown.svelte';

describe('ViewSettingsDropdown', () => {
  afterEach(cleanup);

  it('groups each enabled presentation control into one accessible menu', async () => {
    const handlers = {
      fold: vi.fn(),
      wrap: vi.fn(),
      split: vi.fn(),
      diff: vi.fn(),
      preview: vi.fn(),
      expand: vi.fn(),
    };

    render(ViewSettingsDropdown, {
      props: {
        foldEnabled: true,
        onToggleFold: handlers.fold,
        wrapEnabled: false,
        onToggleWrap: handlers.wrap,
        splitEnabled: true,
        onToggleSplit: handlers.split,
        showDiff: true,
        diffEnabled: false,
        onToggleDiff: handlers.diff,
        showPreview: true,
        previewEnabled: true,
        onTogglePreview: handlers.preview,
        showExpand: true,
        expanded: true,
        onToggleExpand: handlers.expand,
      },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'View settings' }));
    expect(screen.queryByText('View options')).toBeNull();

    const controls = [
      ['Fold unchanged', handlers.fold, 'true'],
      ['Wrap lines', handlers.wrap, 'false'],
      ['Split view', handlers.split, 'true'],
      ['Diff indicators', handlers.diff, 'false'],
      ['Markdown Preview', handlers.preview, 'true'],
      ['All files expanded', handlers.expand, 'true'],
    ] as const;

    for (const [name, handler, checked] of controls) {
      const control = screen.getByRole('menuitemcheckbox', { name });
      expect(control.getAttribute('aria-checked')).toBe(checked);
      await fireEvent.click(control);
      expect(handler).toHaveBeenCalledOnce();
    }
  });
});
