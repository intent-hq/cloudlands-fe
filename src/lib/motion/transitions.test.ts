import { afterEach, describe, expect, it, vi } from 'vitest';
import { blur, crispOut, draw, fade, fly, scale, slide, springIn } from './transitions';

function motionPreference(reduced: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: reduced,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('motion transitions', () => {
  it('reads entrance and exit durations from CSS tier tokens', () => {
    motionPreference(false);
    const node = document.createElement('div');
    node.style.setProperty('--spring-moderate', '0.2s');
    node.style.setProperty('--spring-moderate-exit', '90ms');
    node.style.setProperty('--spring-moderate-ease', 'linear(0, 0.25 50%, 1)');

    const entrance = springIn(node, { tier: 'moderate' });
    const exit = crispOut(node, { tier: 'moderate' });

    expect(entrance.duration).toBe(200);
    expect(entrance.easing?.(0.5)).toBe(0.25);
    expect(exit.duration).toBe(90);
  });

  it('short-circuits entrances and exits when reduced motion is preferred', () => {
    motionPreference(true);
    const node = document.createElement('div');
    node.style.setProperty('--spring-slow', '240ms');
    node.style.setProperty('--spring-slow-exit', '160ms');

    expect(springIn(node, { tier: 'slow' })).toEqual({ duration: 0 });
    expect(crispOut(node, { tier: 'slow' })).toEqual({ duration: 0 });
  });

  it('enters from a two-dimensional anchor offset without changing the exit transform', () => {
    motionPreference(false);
    const node = document.createElement('div');
    const entrance = springIn(node, { tier: 'fast', x: -4, y: 0, scale: 0.96 });
    const exit = crispOut(node, { tier: 'fast' });

    expect(entrance.css?.(0, 1)).toContain('translate3d(-4px,0px,0) scale(0.96)');
    expect(entrance.css?.(1, 0)).toContain('translate3d(0px,0px,0) scale(1)');
    expect(exit.css?.(0, 1)).toBe('opacity:0');
  });

  it('binds compatibility transitions to spring intros and crisp outros', () => {
    motionPreference(false);
    const node = document.createElement('div');
    node.style.setProperty('--spring-moderate', '200ms');
    node.style.setProperty('--spring-moderate-exit', '90ms');

    const deferred = slide(node, { tier: 'moderate', axis: 'x' }, { direction: 'both' });
    expect(typeof deferred).toBe('function');
    if (typeof deferred !== 'function') throw new Error('Expected a deferred transition');
    expect(deferred({ direction: 'in' }).duration).toBe(200);
    expect(deferred({ direction: 'out' }).duration).toBe(90);
  });

  it('supports every baselined transition with semantic-only parameters', () => {
    motionPreference(false);
    const node = document.createElement('div');
    const path = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'path',
    ) as SVGPathElement & {
      getTotalLength: () => number;
    };
    path.getTotalLength = () => 12;

    expect(fade(node, { tier: 'fast' })).toHaveProperty('duration', 80);
    expect(fly(node, { tier: 'moderate', distance: 12, axis: 'x' })).toHaveProperty(
      'duration',
      160,
    );
    expect(scale(node, { tier: 'slow', distance: 0.1 })).toHaveProperty('duration', 240);
    expect(blur(node, { tier: 'moderate', distance: 3 })).toHaveProperty('duration', 160);
    expect(draw(path, { tier: 'moderate' })).toHaveProperty('duration', 160);
  });

  it('short-circuits every compatibility transition for reduced motion', () => {
    motionPreference(true);
    const node = document.createElement('div');
    for (const transition of [fade, fly, slide, scale, blur]) {
      expect(transition(node, { tier: 'slow' })).toEqual({ duration: 0 });
    }
  });
});
