import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDockConversationPopupOwner,
  visiblePopupRect,
} from './dock-conversation-popup-owner';

function box(element: HTMLElement, rect = { x: 20, y: 20, width: 100, height: 60 }) {
  const bounds = {
    ...rect,
    left: rect.x,
    top: rect.y,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
    toJSON: () => rect,
  };
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(bounds);
  vi.spyOn(element, 'getClientRects').mockReturnValue([bounds] as unknown as DOMRectList);
  return element;
}

describe('conversation-owned popup regions', () => {
  let frames: Map<number, FrameRequestCallback>;
  let frameId: number;
  beforeEach(() => {
    frames = new Map();
    frameId = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++frameId, callback);
      return frameId;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  function flush() {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(0));
  }

  it('clips registered content to the viewport and rejects hidden or zero-area roots', () => {
    const popup = box(document.createElement('div'), { x: -10, y: 80, width: 100, height: 60 });
    document.body.append(popup);
    expect(visiblePopupRect(popup, 200, 100)).toEqual({ x: 0, y: 80, width: 90, height: 20 });
    popup.dataset.state = 'closed';
    expect(visiblePopupRect(popup, 200, 100)).toBeNull();
    delete popup.dataset.state;
    popup.hidden = true;
    expect(visiblePopupRect(popup, 200, 100)).toBeNull();
    popup.hidden = false;
    popup.style.visibility = 'hidden';
    expect(visiblePopupRect(popup, 200, 100)).toBeNull();
  });

  it('publishes only its surface and explicit popup content, never unrelated or backdrop nodes', () => {
    const surface = box(document.createElement('div'));
    const target = document.createElement('div');
    const popup = box(document.createElement('div'), { x: 130, y: 20, width: 50, height: 40 });
    const backdrop = box(document.createElement('div'), { x: 0, y: 0, width: 900, height: 900 });
    const unrelated = box(document.createElement('div'));
    target.append(backdrop, popup);
    document.body.append(surface, target, unrelated);
    const regions = vi.fn();
    const owner = createDockConversationPopupOwner({
      surface: () => surface,
      target,
      active: () => true,
      onRegionsChange: regions,
      onPopupStateChange: vi.fn(),
    });
    const remove = owner.register(popup);
    owner.register(unrelated);
    flush();
    expect(regions).toHaveBeenLastCalledWith([
      { x: 20, y: 20, width: 100, height: 60 },
      { x: 130, y: 20, width: 50, height: 40 },
    ]);
    remove();
    flush();
    expect(regions).toHaveBeenLastCalledWith([{ x: 20, y: 20, width: 100, height: 60 }]);
    owner.destroy();
    expect(regions).toHaveBeenLastCalledWith([]);
    expect(frames.size).toBe(0);
  });

  it('closes owned popups on deactivation and rejects late registrations without losing the draft surface', () => {
    const surface = box(document.createElement('div'));
    const target = document.createElement('div');
    const popup = box(document.createElement('div'));
    target.append(popup);
    document.body.append(surface, target);
    let active = true;
    const close = vi.fn();
    const regions = vi.fn();
    const open = vi.fn();
    const owner = createDockConversationPopupOwner({
      surface: () => surface,
      target,
      active: () => active,
      onRegionsChange: regions,
      onPopupStateChange: open,
    });
    owner.register(popup, close);
    flush();
    expect(open).toHaveBeenLastCalledWith(true);
    active = false;
    owner.refresh();
    expect(close).toHaveBeenCalledTimes(1);
    expect(regions).toHaveBeenLastCalledWith([]);
    expect(open).toHaveBeenLastCalledWith(false);
    owner.register(popup, close);
    expect(close).toHaveBeenCalledTimes(2);
    expect(surface.isConnected).toBe(true);
    owner.destroy();
  });

  it('owns inline popup lifecycle while clipping its region to the surface and viewport', () => {
    vi.stubGlobal('innerWidth', 100);
    vi.stubGlobal('innerHeight', 100);
    const surface = box(document.createElement('div'), { x: -20, y: 10, width: 120, height: 100 });
    const popup = box(document.createElement('div'), { x: 80, y: 70, width: 100, height: 80 });
    popup.style.pointerEvents = 'none';
    surface.append(popup);
    const target = document.createElement('div');
    document.body.append(surface, target);
    let active = true;
    const close = vi.fn();
    const regions = vi.fn();
    const open = vi.fn();
    const owner = createDockConversationPopupOwner({
      surface: () => surface,
      target,
      active: () => active,
      onRegionsChange: regions,
      onPopupStateChange: open,
    });
    owner.register(popup, close);
    flush();
    expect(open).toHaveBeenLastCalledWith(true);
    expect(regions).toHaveBeenLastCalledWith([
      { x: 0, y: 10, width: 100, height: 90 },
      { x: 80, y: 70, width: 20, height: 30 },
    ]);
    expect(popup.style.pointerEvents).toBe('auto');
    active = false;
    owner.refresh();
    expect(close).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenLastCalledWith(false);
    expect(regions).toHaveBeenLastCalledWith([]);
    expect(popup.style.pointerEvents).toBe('none');
    owner.destroy();
    expect(close).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  });
});
