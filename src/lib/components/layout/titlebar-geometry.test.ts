import { describe, expect, it } from 'vitest';
import {
  getCounterScaledTitlebarHeight,
  getClippedWorkspaceTabBorderMaskBounds,
  getWorkspaceTabLeadingInsetPx,
  WORKSPACE_TAB_CORNER_RADIUS_PX,
  WORKSPACE_TAB_FLARE_RADIUS_PX,
} from './titlebar-geometry';

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
  it('keeps the closed and open tab insets outside the leading flare', () => {
    expect(getWorkspaceTabLeadingInsetPx(false)).toBe(9);
    expect(getWorkspaceTabLeadingInsetPx(true)).toBe(22);
    expect(getWorkspaceTabLeadingInsetPx(false)).toBeGreaterThanOrEqual(
      WORKSPACE_TAB_FLARE_RADIUS_PX,
    );
  });
  it('uses one radius for the tab corners and flares', () => {
    expect(WORKSPACE_TAB_CORNER_RADIUS_PX).toBe(6);
    expect(WORKSPACE_TAB_FLARE_RADIUS_PX).toBe(WORKSPACE_TAB_CORNER_RADIUS_PX);
  });

  it('clips the expanded active-tab mask to the scroller', () => {
    expect(
      getClippedWorkspaceTabBorderMaskBounds(
        { left: 92, right: 252 },
        { left: 100, right: 220 },
        20,
      ),
    ).toEqual({ left: 80, width: 120 });
    expect(
      getClippedWorkspaceTabBorderMaskBounds(
        { left: 40, right: 80 },
        { left: 100, right: 220 },
        20,
      ),
    ).toBeNull();
  });
});
