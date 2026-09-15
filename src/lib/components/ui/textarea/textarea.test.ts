// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { parseUiComponentMetadata } from '../component-metadata';
import { invalidControlContrastCases } from '../../../../../tests/helpers/invalid-control-contrast';
import Textarea from './textarea.svelte';
import TextareaHarness from './textarea.test-harness.svelte';
import { textareaFixtures } from './textarea.fixtures';
import { textareaMetadata } from './textarea.meta';

afterEach(cleanup);

describe('Textarea', () => {
  it('binds values and preserves labels, descriptions, and errors', async () => {
    const { getByRole, getByTestId } = render(TextareaHarness);
    const textarea = getByRole('textbox', { name: 'Workspace summary' });
    expect(textarea.getAttribute('aria-describedby')).toBe(
      'workspace-summary-description workspace-summary-error',
    );
    await fireEvent.input(textarea, { target: { value: 'A long-running workspace.' } });
    expect(getByTestId('textarea-value').textContent).toBe('A long-running workspace.');
  });

  it('preserves disabled and read-only native states', () => {
    const { getByRole } = render(Textarea, {
      props: { 'aria-label': 'Read-only notes', value: 'Stable', readonly: true },
    });
    const textarea = getByRole('textbox', { name: 'Read-only notes' }) as HTMLTextAreaElement;
    expect(textarea.readOnly).toBe(true);
    expect(textarea.className).toContain('read-only:text-muted-foreground');
  });

  it('uses a contrast-validated invalid border without an outer ring', () => {
    const { getByRole } = render(TextareaHarness);
    const textarea = getByRole('textbox', { name: 'Workspace summary' });
    expect(textarea.className.split(/\s+/)).toContain('aria-invalid:border-danger');
    expect(textarea.className.split(/\s+/)).not.toContain('aria-invalid:ring-1');
    for (const { label, ratio } of invalidControlContrastCases()) {
      expect(ratio, label).toBeGreaterThanOrEqual(3);
    }
  });

  it('publishes resize, validation, compact, theme, and reduced-motion fixtures', () => {
    expect(() => parseUiComponentMetadata(textareaMetadata)).not.toThrow();
    expect(textareaFixtures[0].states).toEqual(
      expect.arrayContaining(['auto-expand', 'max-height-scroll', 'invalid', 'long-content']),
    );
  });

  it('publishes its resolved compact size', () => {
    const { getByRole } = render(Textarea, {
      props: { 'aria-label': 'Editorial notes', size: 'compact' },
    });
    expect(getByRole('textbox', { name: 'Editorial notes' }).dataset.size).toBe('compact');
  });

  it('supports the autoResize alias and connects error feedback', async () => {
    const { getByRole } = render(Textarea, {
      props: {
        id: 'summary',
        'aria-label': 'Summary',
        autoResize: true,
        minHeight: 40,
        maxHeight: 100,
        error: 'A summary is required',
      },
    });
    const textarea = getByRole('textbox', { name: 'Summary' }) as HTMLTextAreaElement;
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 72 });
    await fireEvent.input(textarea, { target: { value: 'Two lines' } });
    expect(textarea.style.height).toBe('72px');
    expect(textarea.getAttribute('aria-describedby')).toBe(getByRole('alert').id);
  });
});
