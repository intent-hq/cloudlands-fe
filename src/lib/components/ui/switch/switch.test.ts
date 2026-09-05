// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseUiComponentMetadata } from '../component-metadata';
import { invalidControlContrastCases } from '../../../../../tests/helpers/invalid-control-contrast';
import Switch from './switch.svelte';
import SwitchHarness from './switch.test-harness.svelte';
import { switchMetadata } from './switch.meta';
import { createSwitchThumbSpring, retargetSwitchThumb } from './switch-motion.svelte';

afterEach(() => cleanup());

describe('Switch', () => {
  it('uses switch semantics, binds state, and supports keyboard activation', async () => {
    const onCheckedChange = vi.fn();
    const { getByRole, getByTestId } = render(SwitchHarness, {
      props: { onCheckedChange },
    });
    const control = getByRole('switch', { name: 'Notifications' });
    expect(control.getAttribute('aria-checked')).toBe('false');

    await fireEvent.keyDown(control, { key: 'Enter' });
    expect(onCheckedChange).toHaveBeenLastCalledWith(true);
    expect(getByTestId('switch-value').textContent).toBe('true');
  });

  it('is form-associated and disabled controls neither submit nor change', async () => {
    const onCheckedChange = vi.fn();
    const { getByRole, getByTestId } = render(SwitchHarness, {
      props: { checked: true, disabled: true, onCheckedChange },
    });
    const control = getByRole('switch', { name: 'Notifications' });
    const form = getByTestId('switch-form') as HTMLFormElement;

    expect(new FormData(form).get('notifications')).toBeNull();
    await fireEvent.click(control);
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it('submits the configured value only while checked', async () => {
    const { getByRole, getByTestId } = render(SwitchHarness, {
      props: { required: true },
    });
    const control = getByRole('switch', { name: 'Notifications' });
    const form = getByTestId('switch-form') as HTMLFormElement;
    const input = form.querySelector('input[name="notifications"]') as HTMLInputElement;
    expect(input.checkValidity()).toBe(false);
    expect(new FormData(form).get('notifications')).toBeNull();
    await fireEvent.click(control);
    expect(input.checkValidity()).toBe(true);
    expect(new FormData(form).get('notifications')).toBe('enabled');
  });

  it('reflects the checked state on the control and thumb', () => {
    const { getByRole } = render(SwitchHarness, { props: { checked: true } });
    const control = getByRole('switch', { name: 'Notifications' });
    expect(control.getAttribute('aria-checked')).toBe('true');
    expect(control.querySelector('[data-state="checked"]')).not.toBeNull();
  });

  it('retargets the same thumb spring when toggled before settling', () => {
    const position = createSwitchThumbSpring(2);
    expect(retargetSwitchThumb(position, 12)).toBe(position);
    expect(position.target).toBe(12);
    expect(retargetSwitchThumb(position, 2)).toBe(position);
    expect(position.target).toBe(2);
  });

  it('uses a contrast-validated invalid border and ring', () => {
    const { getByRole } = render(Switch, {
      props: { ariaLabel: 'Invalid notifications', invalid: true },
    });
    const control = getByRole('switch', { name: 'Invalid notifications' });
    expect(control.className.split(/\s+/)).toContain('border-danger');
    expect(control.className.split(/\s+/)).toContain('ring-danger/25');
    for (const { label, ratio } of invalidControlContrastCases()) {
      expect(ratio, label).toBeGreaterThanOrEqual(3);
    }
  });

  it('publishes valid metadata with off, on, disabled, and invalid fixtures', () => {
    expect(() => parseUiComponentMetadata(switchMetadata)).not.toThrow();
    expect(switchMetadata.fixtures[0].states).toEqual(
      expect.arrayContaining([
        'off',
        'on',
        'solid-primary',
        'inverted-thumb',
        'disabled',
        'invalid',
        'required-invalid',
        'keyboard-focus',
      ]),
    );
  });
});
