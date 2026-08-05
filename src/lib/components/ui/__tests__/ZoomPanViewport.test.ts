import {
  describe,
  it,
  expect,
  vi,
} from 'vitest';
import {
  render,
  fireEvent,
} from '@testing-library/svelte';
import { createRawSnippet, tick } from 'svelte';
import ZoomPanViewport from '../ZoomPanViewport.svelte';

// Mock svelte-fa component
vi.mock('svelte-fa', async () => {
  const MockFa = (await import('./mocks/Fa.svelte')).default;
  return { default: MockFa };
});

// Mock font awesome icons
vi.mock('@fortawesome/free-solid-svg-icons', () => ({
  faMagnifyingGlassMinus: { iconName: 'magnifying-glass-minus' },
  faMagnifyingGlassPlus: { iconName: 'magnifying-glass-plus' },
  faRotateLeft: { iconName: 'rotate-left' },
}));

// Mock the button component
vi.mock('$lib/components/ui/button/button.svelte', async () => {
  const MockButton = (await import('./mocks/button.svelte')).default;
  return { default: MockButton };
});

const children = createRawSnippet(() => ({
  render: () => '<img src="test.png" alt="test content" />',
}));

async function setup(props: { minZoom?: number; maxZoom?: number } = {}) {
  const result = render(ZoomPanViewport, { props: { children, ...props } });
  await tick();
  const viewport = result.container.querySelector<HTMLElement>(
    '[data-testid="zoom-pan-viewport"]'
  )!;
  const content = result.container.querySelector<HTMLElement>(
    '[data-testid="zoom-pan-content"]'
  )!;
  return { ...result, viewport, content };
}

function getScale(content: HTMLElement): number {
  const match = content.getAttribute('style')?.match(/scale\(([\d.]+)\)/);
  expect(match).toBeTruthy();
  return Number.parseFloat(match![1]);
}

function getTranslate(content: HTMLElement): { x: number; y: number } {
  const match = content
    .getAttribute('style')
    ?.match(/translate\((-?[\d.]+)px, (-?[\d.]+)px\)/);
  expect(match).toBeTruthy();
  return { x: Number.parseFloat(match![1]), y: Number.parseFloat(match![2]) };
}

describe('ZoomPanViewport', () => {
  it('renders children at 1x fit scale', async () => {
    const { container, content } = await setup();
    expect(container.querySelector('img[alt="test content"]')).toBeTruthy();
    expect(getScale(content)).toBe(1);
    expect(getTranslate(content)).toEqual({ x: 0, y: 0 });
  });

  it('zooms in on wheel up and out on wheel down', async () => {
    const { viewport, content } = await setup();
    await fireEvent.wheel(viewport, { deltaY: -100, clientX: 0, clientY: 0 });
    const zoomedIn = getScale(content);
    expect(zoomedIn).toBeGreaterThan(1);

    await fireEvent.wheel(viewport, { deltaY: 100, clientX: 0, clientY: 0 });
    expect(getScale(content)).toBeCloseTo(1, 5);
  });

  it('supports ctrl+wheel (trackpad pinch) zoom', async () => {
    const { viewport, content } = await setup();
    await fireEvent.wheel(viewport, {
      deltaY: -20,
      ctrlKey: true,
      clientX: 0,
      clientY: 0,
    });
    expect(getScale(content)).toBeGreaterThan(1);
  });

  it('clamps wheel zoom at min/max bounds', async () => {
    const { viewport, content } = await setup();
    await fireEvent.wheel(viewport, { deltaY: -100000, clientX: 0, clientY: 0 });
    expect(getScale(content)).toBe(8);

    await fireEvent.wheel(viewport, { deltaY: 100000, clientX: 0, clientY: 0 });
    expect(getScale(content)).toBe(0.25);
  });

  it('respects custom min/max zoom bounds', async () => {
    const { viewport, content } = await setup({ minZoom: 0.5, maxZoom: 2 });
    await fireEvent.wheel(viewport, { deltaY: -100000, clientX: 0, clientY: 0 });
    expect(getScale(content)).toBe(2);

    await fireEvent.wheel(viewport, { deltaY: 100000, clientX: 0, clientY: 0 });
    expect(getScale(content)).toBe(0.5);
  });

  it('handles +/-/0 keyboard zoom', async () => {
    const { viewport, content } = await setup();
    await fireEvent.keyDown(viewport, { key: '+' });
    expect(getScale(content)).toBeCloseTo(1.25, 5);

    await fireEvent.keyDown(viewport, { key: '=' });
    expect(getScale(content)).toBeCloseTo(1.5625, 4);

    await fireEvent.keyDown(viewport, { key: '-' });
    expect(getScale(content)).toBeCloseTo(1.25, 5);

    await fireEvent.keyDown(viewport, { key: '0' });
    expect(getScale(content)).toBe(1);
    expect(getTranslate(content)).toEqual({ x: 0, y: 0 });
  });

  it('updates scale from slider input', async () => {
    const { container, content } = await setup();
    const slider = container.querySelector<HTMLInputElement>(
      '[data-testid="zoom-pan-slider"]'
    )!;
    expect(slider.min).toBe('0.25');
    expect(slider.max).toBe('8');

    await fireEvent.input(slider, { target: { value: '2' } });
    expect(getScale(content)).toBe(2);
  });

  it('shows the zoom percentage readout and updates it', async () => {
    const { container } = await setup();
    const percent = container.querySelector<HTMLElement>(
      '[data-testid="zoom-pan-percent"]'
    )!;
    expect(percent.textContent).toContain('100%');

    const slider = container.querySelector<HTMLInputElement>(
      '[data-testid="zoom-pan-slider"]'
    )!;
    await fireEvent.input(slider, { target: { value: '2' } });
    expect(percent.textContent).toContain('200%');
  });

  it('zoom buttons zoom in/out and reset button restores fit', async () => {
    const { container, content } = await setup();
    const zoomIn = container.querySelector<HTMLButtonElement>(
      'button[title="Zoom in"]'
    )!;
    const zoomOut = container.querySelector<HTMLButtonElement>(
      'button[title="Zoom out"]'
    )!;
    const reset = container.querySelector<HTMLButtonElement>(
      'button[title="Reset zoom"]'
    )!;

    await fireEvent.click(zoomIn);
    expect(getScale(content)).toBeCloseTo(1.25, 5);

    await fireEvent.click(zoomOut);
    expect(getScale(content)).toBeCloseTo(1, 5);

    await fireEvent.click(zoomIn);
    await fireEvent.click(reset);
    expect(getScale(content)).toBe(1);
    expect(getTranslate(content)).toEqual({ x: 0, y: 0 });
  });

  it('drag pans the content and suppresses the subsequent click', async () => {
    const { container, viewport, content } = await setup();
    const clickSpy = vi.fn();
    container.addEventListener('click', clickSpy);

    await fireEvent.pointerDown(viewport, {
      pointerId: 1,
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    await fireEvent.pointerMove(viewport, {
      pointerId: 1,
      clientX: 30,
      clientY: 25,
    });
    await fireEvent.pointerUp(viewport, {
      pointerId: 1,
      clientX: 30,
      clientY: 25,
    });

    expect(getTranslate(content)).toEqual({ x: 20, y: 15 });

    // The click synthesized after the drag must not reach ancestors
    await fireEvent.click(viewport);
    expect(clickSpy).not.toHaveBeenCalled();

    // Only the single click following the drag is suppressed
    await fireEvent.click(viewport);
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('does not suppress clicks after a sub-threshold drag', async () => {
    const { container, viewport } = await setup();
    const clickSpy = vi.fn();
    container.addEventListener('click', clickSpy);

    await fireEvent.pointerDown(viewport, {
      pointerId: 1,
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    await fireEvent.pointerMove(viewport, {
      pointerId: 1,
      clientX: 11,
      clientY: 10,
    });
    await fireEvent.pointerUp(viewport, {
      pointerId: 1,
      clientX: 11,
      clientY: 10,
    });

    await fireEvent.click(viewport);
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('exposes handleKeydown on the component instance', async () => {
    const { component, content } = await setup();
    const event = new KeyboardEvent('keydown', { key: '+', cancelable: true });
    expect(component.handleKeydown(event)).toBe(true);
    await tick();
    expect(getScale(content)).toBeCloseTo(1.25, 5);
    expect(event.defaultPrevented).toBe(true);

    const other = new KeyboardEvent('keydown', { key: 'x', cancelable: true });
    expect(component.handleKeydown(other)).toBe(false);
    expect(other.defaultPrevented).toBe(false);
  });

  it('ignores zoom keys with native shortcut modifiers held', async () => {
    const { component, content } = await setup();
    for (const init of [
      { key: '0', metaKey: true },
      { key: '+', ctrlKey: true },
      { key: '-', altKey: true },
    ]) {
      const event = new KeyboardEvent('keydown', { ...init, cancelable: true });
      expect(component.handleKeydown(event)).toBe(false);
      expect(event.defaultPrevented).toBe(false);
    }
    await tick();
    expect(getScale(content)).toBe(1);
  });
});
