import { describe, expect, it } from 'vitest';
import { GRAPH_FIT_PADDING } from '../constants';
import { containedFitScale } from '../graph-fit';

describe('containedFitScale', () => {
  it('yields below the preferred small-graph scale when that scale would clip', () => {
    const bounds = { width: 1_500, height: 900 };
    const available = { width: 1_000, height: 600 };
    const scale = containedFitScale(bounds, available.width, available.height, 2.5);

    expect(scale).toBeLessThan(0.7);
    expect((bounds.width + GRAPH_FIT_PADDING * 2) * scale).toBeLessThanOrEqual(available.width);
    expect((bounds.height + GRAPH_FIT_PADDING * 2) * scale).toBeLessThanOrEqual(available.height);
  });
});
