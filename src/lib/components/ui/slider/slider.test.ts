// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { parseUiComponentMetadata } from '../component-metadata';
import { invalidControlContrastCases } from '../../../../../tests/helpers/invalid-control-contrast';
import Slider from './slider.svelte';
import { sliderFixtures } from './slider.fixtures';
import { sliderMetadata } from './slider.meta';

describe('Slider', () => {
  it('uses native range semantics and reports value changes', async () => {
    const onValueChange = vi.fn();
    const { getByRole } = render(Slider, {
      props: { 'aria-label': 'Volume', value: 40, min: 0, max: 100, step: 5, onValueChange },
    });
    const slider = getByRole('slider', { name: 'Volume' }) as HTMLInputElement;
    expect(slider.valueAsNumber).toBe(40);
    slider.focus();
    await fireEvent.input(slider, { target: { value: '45' } });
    expect(document.activeElement).toBe(slider);
    expect(onValueChange).toHaveBeenLastCalledWith(45);
  });

  it('preserves the disabled native state', () => {
    const { getByRole } = render(Slider, {
      props: { 'aria-label': 'Unavailable volume', disabled: true },
    });
    const slider = getByRole('slider', { name: 'Unavailable volume' }) as HTMLInputElement;
    expect(slider.disabled).toBe(true);
  });

  it('shows the formatted current value only while dragging', async () => {
    const { container, getByRole } = render(Slider, {
      props: { 'aria-label': 'Progress', value: 40, formatValue: (value) => `${value}%` },
    });
    const slider = getByRole('slider', { name: 'Progress' });
    expect(container.querySelector('output')).toBeNull();
    await fireEvent.pointerDown(slider);
    expect(container.querySelector('output')?.textContent).toBe('40%');
    await fireEvent.input(slider, { target: { value: '60' } });
    expect(container.querySelector('output')?.textContent).toBe('60%');
    await fireEvent.pointerUp(slider);
    expect(container.querySelector('output')).toBeNull();
  });

  it('keeps the displayed value synchronized with every pointer move', async () => {
    const onValueChange = vi.fn();
    const { container, getByRole } = render(Slider, {
      props: { 'aria-label': 'Progress', value: 10, onValueChange },
    });
    const slider = getByRole('slider', { name: 'Progress' }) as HTMLInputElement;

    await fireEvent.pointerDown(slider);
    for (const nextValue of [25, 70, 45]) {
      await fireEvent.pointerMove(slider, { target: { value: String(nextValue) } });
      expect(slider.valueAsNumber).toBe(nextValue);
      expect(container.querySelector('output')?.textContent).toBe(String(nextValue));
      expect((container.querySelector('output') as HTMLOutputElement).style.left).toBe(
        `${nextValue}%`,
      );
    }
    expect(onValueChange.mock.calls.map(([nextValue]) => nextValue)).toEqual([25, 70, 45]);
  });

  it('uses a contrast-validated invalid ring and native indicator', () => {
    const { getByRole } = render(Slider, {
      props: { 'aria-label': 'Invalid volume', 'aria-invalid': 'true' },
    });
    const slider = getByRole('slider', { name: 'Invalid volume' });
    expect(slider.getAttribute('aria-invalid')).toBe('true');
    expect(slider.className.split(/\s+/)).toContain('aria-invalid:ring-danger/25');
    expect(slider.className.split(/\s+/)).toContain('aria-invalid:accent-danger');
    for (const { label, ratio } of invalidControlContrastCases()) {
      expect(ratio, label).toBeGreaterThanOrEqual(3);
    }
  });

  it('publishes keyboard, theme, compact, and reduced-motion fixtures', () => {
    expect(() => parseUiComponentMetadata(sliderMetadata)).not.toThrow();
    expect(sliderFixtures.flatMap(({ states }) => states)).toEqual(
      expect.arrayContaining([
        'default',
        'disabled',
        'invalid',
        'keyboard-focus',
        'arrow-keys',
        'home-end',
        'synchronous-drag',
        'semantic-track',
        'semantic-thumb',
        'compact',
        'light',
        'dark',
        'reduced-motion',
      ]),
    );
  });
});
