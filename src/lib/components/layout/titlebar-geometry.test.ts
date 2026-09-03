import { describe, expect, it } from 'vitest';
import { getCounterScaledTitlebarHeight } from './titlebar-geometry';

describe('shared title-bar geometry', () => {
  it.each([
    [0.5, 70],
    [0.67, 52.23880597014925],
    [0.8, 43.75],
    [1, 35],
    [1.25, 28],
    [1.5, 23.333333333333332],
    [2, 17.5],
  ])('counter-scales the %sx zoom band to %spx', (zoomFactor, expectedHeight) => {
    expect(getCounterScaledTitlebarHeight(zoomFactor)).toBeCloseTo(expectedHeight);
  });
});
