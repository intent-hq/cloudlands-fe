import { describe, expect, it } from 'vitest';
import {
  getCounterScaledTitlebarHeight,
  getClippedWorkspaceTabBorderMaskBounds,
  getWorkspaceTabBorderMaskImage,
  getWorkspaceTabLeadingInsetPx,
  getWorkspaceTabScrollerMarginLeftPx,
  getWorkspaceTabScrollerPaddingLeftPx,
  getWorkspaceTabScrollFadeState,
  WORKSPACE_TAB_EDGE_FADE_WIDTH_PX,
  WORKSPACE_TAB_CORNER_RADIUS_PX,
  WORKSPACE_TAB_FLARE_RADIUS_PX,
  WORKSPACE_TAB_LEADING_EDGE_FADE_OFFSET_PX,
  WORKSPACE_TAB_SCROLLER_MARGIN_LEFT_PX,
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
    expect(getWorkspaceTabLeadingInsetPx(false)).toBe(16);
    expect(getWorkspaceTabLeadingInsetPx(true)).toBe(22);
    expect(getWorkspaceTabScrollerPaddingLeftPx(getWorkspaceTabLeadingInsetPx(false))).toBe(6);
    expect(getWorkspaceTabScrollerPaddingLeftPx(getWorkspaceTabLeadingInsetPx(true))).toBe(10);
    expect(
      WORKSPACE_TAB_SCROLLER_MARGIN_LEFT_PX +
        getWorkspaceTabScrollerPaddingLeftPx(getWorkspaceTabLeadingInsetPx(true)),
    ).toBe(18);
    expect(getWorkspaceTabScrollerMarginLeftPx(true)).toBe(WORKSPACE_TAB_SCROLLER_MARGIN_LEFT_PX);
    expect(getWorkspaceTabScrollerMarginLeftPx(false)).toBe(-6);
  });

  it('shows edge fades only where scrolling hides tabs', () => {
    expect(getWorkspaceTabScrollFadeState(0, 500, 300)).toEqual({ left: false, right: true });
    expect(getWorkspaceTabScrollFadeState(100, 500, 300)).toEqual({ left: true, right: true });
    expect(getWorkspaceTabScrollFadeState(200, 500, 300)).toEqual({ left: true, right: false });
    expect(getWorkspaceTabScrollFadeState(0, 300, 300)).toEqual({ left: false, right: false });
  });
  it('uses one radius for the tab corners and flares', () => {
    expect(WORKSPACE_TAB_CORNER_RADIUS_PX).toBe(6);
    expect(WORKSPACE_TAB_FLARE_RADIUS_PX).toBe(WORKSPACE_TAB_CORNER_RADIUS_PX);
  });

  it('clips the active-tab body mask to the scroller', () => {
    expect(
      getClippedWorkspaceTabBorderMaskBounds(
        { left: 92, right: 252 },
        { left: 100, right: 220 },
        20,
      ),
    ).toEqual({ left: 80, width: 120 });
    expect(
      getClippedWorkspaceTabBorderMaskBounds(
        { left: 92, right: 252 },
        { left: 100, right: 220 },
        20,
        { left: true, right: true },
      ),
    ).toEqual({
      left: 80,
      width: 120,
      fadeLeft: {
        start: 80 + WORKSPACE_TAB_LEADING_EDGE_FADE_OFFSET_PX,
        end: 80 + WORKSPACE_TAB_LEADING_EDGE_FADE_OFFSET_PX + WORKSPACE_TAB_EDGE_FADE_WIDTH_PX,
      },
      fadeRight: { start: 200 - WORKSPACE_TAB_EDGE_FADE_WIDTH_PX, end: 200 },
    });
    expect(
      getClippedWorkspaceTabBorderMaskBounds(
        { left: 40, right: 80 },
        { left: 100, right: 220 },
        20,
      ),
    ).toBeNull();
    expect(
      getClippedWorkspaceTabBorderMaskBounds(
        { left: 100, right: 220 },
        { left: 112, right: 180 },
        20,
      ),
    ).toEqual({ left: 92, width: 68 });
  });

  it('aligns the border mask gradient with the scroller fade range', () => {
    const bounds = getClippedWorkspaceTabBorderMaskBounds(
      { left: 112, right: 252 },
      { left: 100, right: 220 },
      20,
      { left: true, right: true },
    );

    expect(bounds).not.toBeNull();
    expect(getWorkspaceTabBorderMaskImage(bounds!)).toBe(
      'linear-gradient(to right, transparent 4px, black 28px, black 84px, transparent 108px)',
    );
    expect(getWorkspaceTabBorderMaskImage({ left: 80, width: 120 })).toBe('none');
  });
});
