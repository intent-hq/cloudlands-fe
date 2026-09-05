import { describe, expect, it, vi } from 'vitest';

import { spring } from '$lib/motion';
import { resize } from '../size-transition';

function createNode(width = 320, height = 240): HTMLElement {
  const node = document.createElement('div');
  vi.spyOn(node, 'getBoundingClientRect').mockReturnValue({
    width,
    height,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  return node;
}

describe('resize transition', () => {
  it('skips layout measurement entirely when motion is disabled', () => {
    const node = createNode();

    const config = resize(node, { enabled: false });

    expect(node.getBoundingClientRect).not.toHaveBeenCalled();
    expect(config.duration).toBe(0);
    expect(config.css).toBeUndefined();
  });

  it('measures and animates the width for a real intro on the x axis', () => {
    const node = createNode(320);

    const config = resize(node, { axis: 'x', tier: 'moderate' });

    expect(node.getBoundingClientRect).toHaveBeenCalledTimes(1);
    expect(config.duration).toBe(spring.moderate.settleMs);
    expect(config.css?.(0.5, 0.5)).toContain('width: 160px');
    expect(config.css?.(1, 0)).toContain('width: 320px');
  });

  it('measures and animates the height on the y axis', () => {
    const node = createNode(320, 240);

    const config = resize(node, { axis: 'y', tier: 'moderate' });

    expect(node.getBoundingClientRect).toHaveBeenCalledTimes(1);
    expect(config.css?.(0.5, 0.5)).toContain('height: 120px');
  });
});
