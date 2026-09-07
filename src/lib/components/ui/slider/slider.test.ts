// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { invalidControlContrastCases } from '../../../../../tests/helpers/invalid-control-contrast';
import { parseUiComponentMetadata } from '../component-metadata';
import Slider from './slider.svelte';
import { sliderFixtures } from './slider.fixtures';
import { sliderMetadata } from './slider.meta';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mockTrack(container: HTMLElement, width = 200, left = 0): HTMLElement {
  const track = container.querySelector<HTMLElement>('[data-slot="slider-track"]')!;
  Object.defineProperty(track, 'offsetWidth', { configurable: true, value: width });
  vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
    x: left,
    y: 0,
    left,
    right: left + width,
    top: 0,
    bottom: 36,
    width,
    height: 36,
    toJSON: () => ({}),
  });
  return track;
}

describe('Slider', () => {
  it('applies external bounds before an initial value above the native default maximum', () => {
    const { getByRole } = render(Slider, {
      props: { 'aria-label': 'Memory budget', value: 1500, min: 0, max: 32768 },
    });

    const slider = getByRole('slider', { name: 'Memory budget' }) as HTMLInputElement;
    expect(slider.max).toBe('32768');
    expect(slider.valueAsNumber).toBe(1500);
  });

  it('keeps native range semantics and reports each committed input once', async () => {
    const onValueChange = vi.fn();
    const { getByRole } = render(Slider, {
      props: {
        'aria-label': 'Volume',
        value: 40,
        min: 0,
        max: 100,
        step: 5,
        formatValue: (value) => `${value}%`,
        onValueChange,
      },
    });
    const slider = getByRole('slider', { name: 'Volume' }) as HTMLInputElement;
    slider.focus();
    await fireEvent.input(slider, { target: { value: '45' } });

    expect(document.activeElement).toBe(slider);
    expect(slider.valueAsNumber).toBe(45);
    expect(slider.getAttribute('aria-valuenow')).toBe('45');
    expect(slider.getAttribute('aria-valuetext')).toBe('45%');
    expect(onValueChange).toHaveBeenCalledOnce();
    expect(onValueChange).toHaveBeenCalledWith(45);
  });

  it('snaps a track press and follows pointer dragging synchronously', async () => {
    const onValueChange = vi.fn();
    const onchange = vi.fn();
    const { container, getByRole } = render(Slider, {
      props: { 'aria-label': 'Progress', value: 0, onValueChange, onchange },
    });
    const track = mockTrack(container);
    const slider = getByRole('slider', { name: 'Progress' }) as HTMLInputElement;

    await fireEvent.pointerDown(track, { clientX: 145, pointerId: 1, button: 0 });
    expect(slider.valueAsNumber).toBe(75);
    expect(document.activeElement).toBe(slider);
    await fireEvent.pointerMove(track, { clientX: 46, pointerId: 1 });
    expect(slider.valueAsNumber).toBe(20);
    expect(container.querySelector('[data-slot="slider-thumb"]')?.getAttribute('style')).toContain(
      'left: calc(20% - 4px)',
    );
    await fireEvent.pointerUp(track, { pointerId: 1 });

    expect(onValueChange.mock.calls.map(([next]) => next)).toEqual([75, 20]);
    expect(onchange).toHaveBeenCalledOnce();
  });

  it('supports arrows, Home, End, and Page keys from the focusable slider', async () => {
    const onValueChange = vi.fn();
    const { getByRole } = render(Slider, {
      props: { 'aria-label': 'Keyboard volume', value: 40, step: 5, onValueChange },
    });
    const slider = getByRole('slider', { name: 'Keyboard volume' }) as HTMLInputElement;

    await fireEvent.keyDown(slider, { key: 'ArrowRight' });
    await fireEvent.keyDown(slider, { key: 'PageUp' });
    await fireEvent.keyDown(slider, { key: 'End' });
    await fireEvent.keyDown(slider, { key: 'Home' });

    expect(onValueChange.mock.calls.map(([next]) => next)).toEqual([45, 95, 100, 0]);
    expect(slider.valueAsNumber).toBe(0);
  });

  it('shows a hover preview tooltip and hides it while pressed', async () => {
    vi.useFakeTimers();
    const { container } = render(Slider, {
      props: { 'aria-label': 'Preview', value: 25, formatValue: (value) => `${value}%` },
    });
    const track = mockTrack(container);

    await fireEvent.pointerEnter(track);
    await fireEvent.pointerMove(track, { clientX: 100 });
    expect(container.querySelector('[data-slot="slider-tooltip"]')).toBeNull();
    await vi.advanceTimersByTimeAsync(100);
    expect(container.querySelector('[data-slot="slider-tooltip"]')?.textContent).toBe('50%');

    await fireEvent.pointerDown(track, { clientX: 100, pointerId: 1, button: 0 });
    expect(
      (container.querySelector('[data-slot="slider-tooltip"]') as HTMLOutputElement).hidden,
    ).toBe(true);
  });

  it('derives bounds from discrete steps, snaps, and renders pips', async () => {
    const onValueChange = vi.fn();
    const steps = [0.1, 0.5, 0.7, 1.3];
    const { container, getByRole } = render(Slider, {
      props: { 'aria-label': 'Rate', value: 0.1, steps, showSteps: true, onValueChange },
    });
    const track = mockTrack(container);
    const slider = getByRole('slider', { name: 'Rate' }) as HTMLInputElement;

    expect(slider.min).toBe('0.1');
    expect(slider.max).toBe('1.3');
    expect(container.querySelectorAll('[data-slot="slider-pip"]')).toHaveLength(4);
    await fireEvent.pointerDown(track, { clientX: 100, pointerId: 1, button: 0 });
    expect(slider.valueAsNumber).toBe(0.7);
    await fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(slider.valueAsNumber).toBe(1.3);
    expect(onValueChange.mock.calls.map(([next]) => next)).toEqual([0.7, 1.3]);
  });

  it('edits the inline value with commit, clamp, snap, and cancel behavior', async () => {
    const onValueChange = vi.fn();
    const { container, getByRole } = render(Slider, {
      props: {
        'aria-label': 'Editable volume',
        value: 40,
        min: 0,
        max: 100,
        step: 10,
        showValue: true,
        valuePosition: 'right',
        onValueChange,
      },
    });

    await fireEvent.click(container.querySelector('[data-slot="slider-value"] button')!);
    const editor = getByRole('spinbutton', { name: 'Editable volume' });
    await fireEvent.input(editor, { target: { value: '87' } });
    await fireEvent.keyDown(editor, { key: 'Enter' });
    expect(onValueChange).toHaveBeenLastCalledWith(90);
    expect(container.querySelector('[data-slot="slider-value"]')?.textContent).toBe('90');

    await fireEvent.click(container.querySelector('[data-slot="slider-value"] button')!);
    const cancelledEditor = getByRole('spinbutton', { name: 'Editable volume' });
    await fireEvent.input(cancelledEditor, { target: { value: '20' } });
    await fireEvent.keyDown(cancelledEditor, { key: 'Escape' });
    expect(container.querySelector('[data-slot="slider-value"]')?.textContent).toBe('90');
    expect(onValueChange).toHaveBeenCalledOnce();
  });

  it('is inert when disabled and uses danger visuals when invalid', async () => {
    const onValueChange = vi.fn();
    const { container, getByRole } = render(Slider, {
      props: {
        'aria-label': 'Unavailable volume',
        value: 25,
        disabled: true,
        'aria-invalid': 'true',
        onValueChange,
      },
    });
    const slider = getByRole('slider', { name: 'Unavailable volume' }) as HTMLInputElement;
    const track = mockTrack(container);

    await fireEvent.pointerDown(track, { clientX: 180, pointerId: 1, button: 0 });
    expect(slider.disabled).toBe(true);
    expect(slider.valueAsNumber).toBe(25);
    expect(onValueChange).not.toHaveBeenCalled();
    expect(container.querySelector('[data-slot="slider-root"]')?.className).toContain('opacity-50');
    expect(container.querySelector('[data-slot="slider-thumb"]')?.className).toContain(
      'border-danger',
    );
    expect(container.querySelector('[data-slot="slider-fill"]')?.className).toContain(
      'bg-danger/30',
    );
    expect(slider.className.split(/\s+/)).toContain('aria-invalid:ring-danger/25');
    for (const { label, ratio } of invalidControlContrastCases()) {
      expect(ratio, label).toBeGreaterThanOrEqual(3);
    }
  });

  it('settles pointer travel instantly for reduced motion', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    );
    const { container } = render(Slider, { props: { 'aria-label': 'Reduced', value: 0 } });
    const track = mockTrack(container);

    await fireEvent.pointerDown(track, { clientX: 100, pointerId: 1, button: 0 });
    expect(container.querySelector('[data-slot="slider-thumb"]')?.getAttribute('style')).toContain(
      'left: calc(50% - 10px)',
    );
  });

  it('publishes the full interaction fixture contract', () => {
    expect(() => parseUiComponentMetadata(sliderMetadata)).not.toThrow();
    expect(sliderFixtures.flatMap(({ states }) => states)).toEqual(
      expect.arrayContaining([
        'hover-preview',
        'hover-tooltip',
        'drag-tooltip-hidden',
        'inline-value-edit',
        'discrete-steps',
        'step-pips',
        'capture-hover-drag-200ms',
        'reduced-motion',
      ]),
    );
  });
});
