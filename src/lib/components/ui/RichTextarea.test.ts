// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/svelte';
import axe from 'axe-core';
import type { ComponentProps } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import RichTextarea from './RichTextarea.svelte';

// @ts-expect-error RichTextarea requires an accessible name.
const unnamedProps: ComponentProps<typeof RichTextarea> = {};
void unnamedProps;

afterEach(cleanup);

describe('RichTextarea accessible names', () => {
  it('has no unnamed input fields after the editor mounts', async () => {
    const { container } = render(RichTextarea, { ariaLabel: 'Project instructions' });
    await waitFor(() => expect(container.querySelector('[contenteditable="true"]')).toBeTruthy());
    const result = await axe.run(container, { runOnly: ['aria-input-field-name'] });
    expect(result.violations).toEqual([]);
  });

  it('names the wrapper and editable textbox and updates both names', async () => {
    const view = render(RichTextarea, { ariaLabel: 'Project instructions' });
    await waitFor(() =>
      expect(view.getAllByRole('textbox', { name: 'Project instructions' })).toHaveLength(2),
    );
    await view.rerender({ ariaLabel: 'Revised instructions' });
    await waitFor(() =>
      expect(view.getAllByRole('textbox', { name: 'Revised instructions' })).toHaveLength(2),
    );
  });
});
