import { describe, expect, it } from 'vitest';
import { dockToolbarPosition, extendDockPenPoints, finishDockPenPoints } from './dock-annotation';

// A 1440×900 display: menu bar (25) above, macOS Dock (70) below.
const area = { x: 0, y: 25, width: 1440, height: 805 };
const bar = { width: 173, height: 38 };
const bottomCentre = { x: Math.round((1440 - 173) / 2), y: 25 + 805 - 38 - 16 };

describe('dockToolbarPosition', () => {
  it('starts at the bottom centre of the work area, wherever the dock is', () => {
    expect(dockToolbarPosition(bar, area)).toEqual(bottomCentre);
  });

  it('keeps every control reachable in work areas with nonzero display origins', () => {
    for (const offset of [
      { x: -1440, y: 125 },
      { x: 1920, y: -875 },
    ]) {
      const workArea = { ...area, ...offset };
      const position = dockToolbarPosition(bar, workArea);
      expect(position).toEqual({
        x: bottomCentre.x + offset.x,
        y: bottomCentre.y - 25 + offset.y,
      });
      expect(position.x + bar.width).toBeLessThanOrEqual(workArea.x + workArea.width);
      expect(position.y + bar.height).toBeLessThanOrEqual(workArea.y + workArea.height);
    }
  });

  it('stays inside a work area smaller than the bar', () => {
    expect(dockToolbarPosition(bar, { x: 10, y: 20, width: 100, height: 30 })).toEqual({
      x: 10,
      y: 20,
    });
  });
});

describe('bounded observed pen path',()=>{
 it('never reconnects a capped unobserved tail to a distant release',()=>{
  let state={points:[{x:0,y:0}],capped:false};
  state=extendDockPenPoints(state,[{x:1,y:1},{x:2,y:2}],4);
  expect(state.capped).toBe(false);
  state=extendDockPenPoints(state,[{x:20,y:20},{x:21,y:21}],4);
  expect(state.capped).toBe(true);
  state=extendDockPenPoints(state,[{x:22,y:22}],4);
  expect(finishDockPenPoints(state,{x:100,y:100})).toEqual([{x:0,y:0},{x:1,y:1},{x:2,y:2}]);
 });
 it('keeps the ordinary observed order and uncapped release endpoint',()=>{
  const state=extendDockPenPoints({points:[{x:0,y:0}],capped:false},[{x:1,y:2},{x:3,y:4}]);
  expect(finishDockPenPoints(state,{x:5,y:6})).toEqual([{x:0,y:0},{x:1,y:2},{x:3,y:4},{x:5,y:6}]);
 });
});
