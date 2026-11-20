import { afterEach, describe, expect, it } from 'vitest';
import { coveredSlots } from '../browser-view-overlays';

function box(element: HTMLElement, rect: { x: number; y: number; width: number; height: number }) {
  element.getBoundingClientRect = () =>
    ({
      ...rect,
      left: rect.x,
      top: rect.y,
      right: rect.x + rect.width,
      bottom: rect.y + rect.height,
      toJSON: () => rect,
    }) as DOMRect;
  return element;
}

function overlay(rect: { x: number; y: number; width: number; height: number }, role = 'menu') {
  const element = box(document.createElement('div'), rect);
  element.setAttribute('role', role);
  element.style.position = 'fixed';
  document.body.append(element);
  return element;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('coveredSlots', () => {
  const slotRect = { x: 100, y: 100, width: 400, height: 300 };

  it('covers a slot an open floating overlay intersects', () => {
    const slot = box(document.createElement('div'), slotRect);
    const other = box(document.createElement('div'), { x: 600, y: 100, width: 200, height: 200 });
    document.body.append(slot, other);
    const menu = overlay({ x: 450, y: 120, width: 100, height: 100 });

    expect(coveredSlots([slot, other], [menu], false)).toEqual(new Set([slot]));
  });

  it('ignores overlays beside the slot, hidden ones, in-flow ones and the slot content', () => {
    const slot = box(document.createElement('div'), slotRect);
    document.body.append(slot);
    const beside = overlay({ x: 0, y: 0, width: 50, height: 50 });
    const hidden = overlay({ x: 150, y: 150, width: 50, height: 50 });
    hidden.style.display = 'none';
    const inFlow = overlay({ x: 150, y: 150, width: 50, height: 50 }, 'listbox');
    inFlow.style.position = 'static';
    const inside = box(document.createElement('div'), { x: 150, y: 150, width: 50, height: 50 });
    inside.setAttribute('role', 'dialog');
    inside.style.position = 'fixed';
    slot.append(inside);

    expect(coveredSlots([slot], [beside, hidden, inFlow, inside], false).size).toBe(0);
  });

  it('covers every slot while the pointer works over the app (tab drag, panel resize)', () => {
    const slot = box(document.createElement('div'), slotRect);
    document.body.append(slot);
    expect(coveredSlots([slot], [], true)).toEqual(new Set([slot]));
  });
});
