import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import CommentDialog from '../CommentDialog.svelte';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

async function renderDialog(props: Record<string, unknown> = {}) {
  const result = render(CommentDialog, { props: { x: 10, y: 20, ...props } });
  // The dialog renders through Portal, which mounts its children
  // asynchronously — wait for the textarea to appear in the document.
  const textarea = await waitFor(() => {
    const el = document.querySelector('textarea');
    expect(el).not.toBeNull();
    return el as HTMLTextAreaElement;
  });
  return { ...result, textarea };
}

describe('CommentDialog', () => {
  it('focuses the textarea when the dialog opens', async () => {
    const { textarea } = await renderDialog();

    await waitFor(() => {
      expect(document.activeElement).toBe(textarea);
    });
  });

  it('re-asserts focus if another element steals it right after mount', async () => {
    const { textarea } = await renderDialog();

    // Simulate the editor/button stealing focus back after the dialog mounts.
    const stealer = document.createElement('button');
    document.body.appendChild(stealer);
    stealer.focus();
    expect(document.activeElement).toBe(stealer);

    // The delayed retry (setTimeout fallback) should reclaim focus.
    await waitFor(() => {
      expect(document.activeElement).toBe(textarea);
    });
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    const { textarea } = await renderDialog({ onClose });

    await fireEvent.keyDown(textarea, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('submits trimmed content on Ctrl+Enter', async () => {
    const onSubmit = vi.fn();
    const { textarea } = await renderDialog({ onSubmit });

    await fireEvent.input(textarea, { target: { value: '  hello world  ' } });
    await fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const event = onSubmit.mock.calls[0][0] as CustomEvent<{ content: string; type: string }>;
    expect(event.detail).toEqual({ content: 'hello world', type: 'comment' });
  });
});
