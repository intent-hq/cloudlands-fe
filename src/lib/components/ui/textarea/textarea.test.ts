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
    expect(textarea.className).toContain('read-only:bg-muted/30');
  });

  it('uses a contrast-validated invalid border and ring', () => {
    const { getByRole } = render(TextareaHarness);
    const textarea = getByRole('textbox', { name: 'Workspace summary' });
    expect(textarea.className.split(/\s+/)).toContain('aria-invalid:border-danger');
    expect(textarea.className.split(/\s+/)).toContain('aria-invalid:ring-danger/25');
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

  it('uses the shared Body, neutral field, radius, and elevation language', () => {
    const { getByRole } = render(Textarea, { props: { 'aria-label': 'Editorial notes' } });
    const textarea = getByRole('textbox', { name: 'Editorial notes' });
    expect(textarea.className).toContain('type-body');
    expect(textarea.className).toContain('border-border');
    expect(textarea.className).toContain('bg-card');
    expect(textarea.className).toContain('hover:border-input');
    expect(textarea.className).toContain('focus-visible:border-ring');
    expect(textarea.className).toContain('focus-visible:outline-none');
    expect(textarea.className).toContain('focus-visible:ring-0');
    expect(textarea.className).not.toContain('focus-visible:ring-2');
    expect(textarea.className).not.toContain('focus-visible:ring-ring/40');
    expect(textarea.className).toContain('rounded-(--radius-medium)');
    expect(textarea.className).toContain('shadow-(--elevation-raised)');
  });
});
