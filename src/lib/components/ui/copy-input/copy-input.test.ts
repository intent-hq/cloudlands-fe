// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CopyButton from '../CopyButton.svelte';
import { parseUiComponentMetadata } from '../component-metadata';
import CopyInput from './copy-input.svelte';
import { copyInputFixtures } from './copy-input.fixtures';
import { copyInputMetadata } from './copy-input.meta';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function clipboard(writeText = vi.fn().mockResolvedValue(undefined)) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  return writeText;
}

describe('CopyInput', () => {
  it('exposes a read-only value and announces spring-backed copy feedback', async () => {
    const writeText = clipboard();
    const onCopy = vi.fn();
    const { container, getByRole } = render(CopyInput, {
      props: { value: 'intent://workspace/one', label: 'Workspace link', onCopy },
    });
    const input = getByRole('textbox', { name: 'Workspace link' }) as HTMLInputElement;

    expect(input.readOnly).toBe(true);
    expect(input.value).toBe('intent://workspace/one');
    await fireEvent.click(getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(getByRole('button', { name: 'Copied!' })).toBeTruthy());
    expect(writeText).toHaveBeenCalledWith('intent://workspace/one');
    expect(onCopy).toHaveBeenCalledOnce();
    expect(container.querySelector('[data-slot="copy-button-icon"]')).toBeTruthy();
  });

  it('keeps the legacy CopyButton path on the canonical Button primitive', async () => {
    const writeText = clipboard();
    const { getByRole } = render(CopyButton, { props: { text: 'legacy' } });
    const button = getByRole('button', { name: 'Copy' });
    expect(button.getAttribute('data-slot')).toBe('button');
    await fireEvent.click(button);
    expect(writeText).toHaveBeenCalledWith('legacy');
  });

  it('publishes rest, hover, focus, error, disabled, and copied states', () => {
    expect(() => parseUiComponentMetadata(copyInputMetadata)).not.toThrow();
    expect(copyInputFixtures[0].states).toEqual(
      expect.arrayContaining(['rest', 'hover', 'focus', 'error', 'disabled', 'copied']),
    );
  });
});
