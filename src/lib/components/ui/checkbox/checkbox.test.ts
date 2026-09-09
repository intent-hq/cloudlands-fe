// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseUiComponentMetadata } from '../component-metadata';
import { invalidControlContrastCases } from '../../../../../tests/helpers/invalid-control-contrast';
import Checkbox from './checkbox.svelte';
import CheckboxHarness from './checkbox.test-harness.svelte';
import { checkboxMetadata } from './checkbox.meta';

afterEach(() => cleanup());

describe('Checkbox', () => {
  it('exposes controlled checked and mixed states with an accessible name', async () => {
    const { getByRole, rerender } = render(CheckboxHarness, {
      props: { indeterminate: true },
    });
    const checkbox = getByRole('checkbox', { name: 'Accept choice' });
    expect(checkbox.getAttribute('aria-checked')).toBe('mixed');
    expect(checkbox.getAttribute('data-state')).toBe('indeterminate');

    await rerender({ checked: true, indeterminate: false });
    expect(checkbox.getAttribute('aria-checked')).toBe('true');
    await rerender({ checked: false, indeterminate: false });
    expect(checkbox.getAttribute('aria-checked')).toBe('false');
  });

  it('is form-associated, bindable, required, and preserves name/value', async () => {
    const { getByRole, getByTestId } = render(CheckboxHarness, {
      props: { required: true },
    });
    const checkbox = getByRole('checkbox', { name: 'Accept choice' });
    const form = getByTestId('checkbox-form') as HTMLFormElement;
    const input = form.querySelector('input[name="choice"]') as HTMLInputElement;

    expect(input.checkValidity()).toBe(false);
    expect(new FormData(form).get('choice')).toBeNull();
    await fireEvent.click(checkbox);
    expect(getByTestId('checkbox-value').textContent).toBe('true');
    expect(input.checkValidity()).toBe(true);
    expect(new FormData(form).get('choice')).toBe('selected');
  });

  it('supports Space and blocks interaction while disabled', async () => {
    const onCheckedChange = vi.fn();
    const { getByRole, getByTestId, rerender } = render(CheckboxHarness, {
      props: { onCheckedChange },
    });
    const checkbox = getByRole('checkbox', { name: 'Accept choice' });

    await fireEvent.keyDown(checkbox, { key: ' ' });
    expect(onCheckedChange).toHaveBeenLastCalledWith(true);
    await rerender({ disabled: true, onCheckedChange });
    await fireEvent.click(checkbox);
    expect(onCheckedChange).toHaveBeenCalledTimes(1);
    expect(new FormData(getByTestId('checkbox-form') as HTMLFormElement).get('choice')).toBeNull();
  });

  it('exposes a compact control with an expanded hit target and invalid state', () => {
    const { getByRole } = render(CheckboxHarness);
    const checkbox = getByRole('checkbox', { name: 'Accept choice' });
    expect(checkbox.className).toContain('after:-inset-1.5');
    expect(checkbox.className).toContain('h-4');
    expect(checkbox.className).toContain('border-border');
    expect(checkbox.className).toContain('hover:border-input');
    expect(checkbox.className).toContain('rounded-(--radius-small)');
    expect(checkbox.className).toContain('shadow-(--elevation-raised)');
  });

  it('uses a contrast-validated invalid border and ring', () => {
    const { getByRole } = render(Checkbox, {
      props: { ariaLabel: 'Invalid choice', invalid: true },
    });
    const checkbox = getByRole('checkbox', { name: 'Invalid choice' });
    expect(checkbox.className.split(/\s+/)).toContain('border-danger');
    expect(checkbox.className.split(/\s+/)).toContain('ring-danger/25');
    for (const { label, ratio } of invalidControlContrastCases()) {
      expect(ratio, label).toBeGreaterThanOrEqual(3);
    }
  });

  it('publishes valid metadata and a complete fixture state matrix', () => {
    expect(() => parseUiComponentMetadata(checkboxMetadata)).not.toThrow();
    expect(checkboxMetadata.fixtures[0].states).toEqual(
      expect.arrayContaining([
        'unchecked',
        'checked',
        'mixed',
        'disabled',
        'invalid',
        'required-invalid',
        'keyboard-focus',
      ]),
    );
  });
});
