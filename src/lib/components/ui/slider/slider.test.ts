// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
        'semantic-track',
        'semantic-thumb',
        'compact',
        'light',
        'dark',
        'reduced-motion',
      ]),
    );
  });

  it('uses a native semantic slider with tokenized compact track and thumb styles', () => {
    const { getByRole } = render(Slider, { props: { 'aria-label': 'Zoom', value: 50 } });
    const slider = getByRole('slider', { name: 'Zoom' });
    expect(slider.className).toContain('operate-slider');
    expect(slider.className).toContain('h-(--control-height-medium)');
    expect(slider.className).toContain('rounded-(--radius-medium)');
    expect(slider.className).toContain('focus-visible:ring-ring/40');
    const source = readFileSync(
      resolve(process.cwd(), 'src/lib/components/ui/slider/slider.svelte'),
      'utf8',
    );
    expect(source).toMatch(/slider-thumb[\s\S]*?width: 3px/);
    expect(source).toMatch(/slider-thumb[\s\S]*?border-radius: var\(--radius-full\)/);
  });
});
