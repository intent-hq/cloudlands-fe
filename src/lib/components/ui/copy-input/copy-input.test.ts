// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CopyButton from '../CopyButton.svelte';
import { parseUiComponentMetadata } from '../component-metadata';
import CopyInput from './copy-input.svelte';
import { copyInputFixtures } from './copy-input.fixtures';
import { copyInputMetadata } from './copy-input.meta';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function clipboard(writeText = vi.fn().mockResolvedValue(undefined)) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  return writeText;
}

describe('CopyInput', () => {
  it('copies the displayed value and announces success with its label', async () => {
    const writeText = clipboard();
    const onCopy = vi.fn();
    const { container, getByRole, getByText } = render(CopyInput, {
      props: { value: 'intent://workspace/one', label: 'Workspace link', onCopy },
    });
    const button = getByRole('button', { name: 'Copy Workspace link' });

    expect(getByText('intent://workspace/one')).toBeTruthy();
    await fireEvent.click(button);
    expect(getByRole('button', { name: 'Copied Workspace link' })).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith('intent://workspace/one');
    expect(onCopy).toHaveBeenCalledOnce();
    expect(container.querySelector('[data-slot="copy-input-feedback"] path')).toBeTruthy();
  });

  it('falls back to execCommand when the Clipboard API rejects', async () => {
    clipboard(vi.fn().mockRejectedValue(new Error('denied')));
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const onCopy = vi.fn();
    const { getByRole } = render(CopyInput, { props: { value: 'fallback', onCopy } });

    await fireEvent.click(getByRole('button', { name: 'Copy to clipboard' }));

    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(getByRole('button', { name: 'Copied' })).toBeTruthy();
    expect(onCopy).toHaveBeenCalledOnce();
    expect(document.body.querySelector('textarea')).toBeNull();
  });

  it('shows failure feedback when both clipboard paths fail', async () => {
    clipboard(vi.fn().mockRejectedValue(new Error('denied')));
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => false),
    });
    const onCopy = vi.fn();
    const { container, getByRole } = render(CopyInput, {
      props: { value: 'unavailable', variant: 'button', onCopy },
    });

    await fireEvent.click(getByRole('button', { name: 'Copy to clipboard' }));

    expect(getByRole('button', { name: 'Copy failed' })).toBeTruthy();
    expect(container.querySelector('[data-slot="copy-input-feedback"].text-danger')).toBeTruthy();
    await waitFor(() =>
      expect(
        [...container.querySelectorAll('[data-slot="copy-input-action-label"]')].some(
          (element) => element.textContent?.trim() === 'Failed',
        ),
      ).toBe(true),
    );
    expect(onCopy).not.toHaveBeenCalled();
  });

  it('returns to the idle state after two seconds', async () => {
    vi.useFakeTimers();
    clipboard();
    const { getByRole } = render(CopyInput, { props: { value: 'temporary' } });

    await fireEvent.click(getByRole('button', { name: 'Copy to clipboard' }));
    expect(getByRole('button', { name: 'Copied' })).toBeTruthy();
    await vi.advanceTimersByTimeAsync(2000);
    await tick();

    expect(getByRole('button', { name: 'Copy to clipboard' })).toBeTruthy();
  });

  it('keeps the button label width stable and places a left-aligned action first', async () => {
    clipboard();
    const { container, getByRole } = render(CopyInput, {
      props: { value: 'left value', variant: 'button', align: 'left' },
    });
    const button = getByRole('button', { name: 'Copy to clipboard' });

    const action = button.querySelector('[data-slot="copy-input-action"]');
    const value = button.querySelector('[data-slot="copy-input-value"]');
    expect(action?.compareDocumentPosition(value as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(
      container.querySelector('[data-slot="copy-input-action-label"]')?.textContent?.trim(),
    ).toBe('Copy');
    await fireEvent.click(button);
    await waitFor(() =>
      expect(
        [...container.querySelectorAll('[data-slot="copy-input-action-label"]')].some(
          (element) => element.textContent?.trim() === 'Copied',
        ),
      ).toBe(true),
    );
  });

  it('is inert when disabled and publishes the inherited size', async () => {
    const writeText = clipboard();
    const { getByRole } = render(CopyInput, {
      props: { value: 'disabled', disabled: true, size: 'compact' },
    });
    const button = getByRole('button', { name: 'Copy to clipboard' });

    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute('data-size')).toBe('compact');
    await fireEvent.click(button);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('keeps the legacy CopyButton path on the canonical Button primitive', async () => {
    const writeText = clipboard();
    const { getByRole } = render(CopyButton, { props: { text: 'legacy' } });
    const button = getByRole('button', { name: 'Copy' });
    expect(button.getAttribute('data-slot')).toBe('button');
    await fireEvent.click(button);
    expect(writeText).toHaveBeenCalledWith('legacy');
  });

  it('publishes the reference state matrix', () => {
    expect(() => parseUiComponentMetadata(copyInputMetadata)).not.toThrow();
    expect(copyInputFixtures[0].states).toEqual(
      expect.arrayContaining([
        'rest',
        'hover',
        'focus',
        'copied',
        'error-feedback',
        'disabled',
        'button-variant',
        'left-aligned',
      ]),
    );
  });
});
