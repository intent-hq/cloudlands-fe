/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pushEscapeLayer } from '$lib/utils/escapeLayers';
import { registerEnhancingComposer } from './enhance-escape';

function escapeOn(target: EventTarget) {
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

function composer() {
  const container = document.createElement('div');
  const inner = document.createElement('button');
  container.appendChild(inner);
  document.body.appendChild(container);
  return { container, inner, cancel: vi.fn() };
}

const releases: Array<() => void> = [];
afterEach(() => {
  releases.splice(0).forEach((release) => release());
  document.body.innerHTML = '';
});

describe('registerEnhancingComposer (intent-hq/intent#5758)', () => {
  it('routes Escape to the composer containing the target, earliest or latest', () => {
    const a = composer();
    const b = composer();
    releases.push(registerEnhancingComposer(() => a.container, a.cancel));
    releases.push(registerEnhancingComposer(() => b.container, b.cancel));

    escapeOn(a.inner);
    expect(a.cancel).toHaveBeenCalledOnce();
    expect(b.cancel).not.toHaveBeenCalled();

    escapeOn(b.inner);
    expect(b.cancel).toHaveBeenCalledOnce();
    expect(a.cancel).toHaveBeenCalledOnce();
  });

  it('on an unfocused document cancels the composer that held focus, else the latest', () => {
    const a = composer();
    const b = composer();
    a.inner.focus();
    releases.push(registerEnhancingComposer(() => a.container, a.cancel));
    a.inner.blur();
    releases.push(registerEnhancingComposer(() => b.container, b.cancel));

    escapeOn(document.body);
    expect(a.cancel).toHaveBeenCalledOnce();
    expect(b.cancel).not.toHaveBeenCalled();

    releases.shift()!();
    escapeOn(document.body);
    expect(b.cancel).toHaveBeenCalledOnce();
  });

  it('declines an Escape elsewhere so it reaches its own handlers', () => {
    const a = composer();
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    const outsideHandler = vi.fn();
    outside.addEventListener('keydown', outsideHandler);
    releases.push(registerEnhancingComposer(() => a.container, a.cancel));

    const event = escapeOn(outside);
    expect(a.cancel).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(outsideHandler).toHaveBeenCalledOnce();
  });

  it('keeps an overlay opened during enhancement above it', () => {
    const a = composer();
    releases.push(registerEnhancingComposer(() => a.container, a.cancel));
    const closeOverlay = vi.fn();
    releases.push(pushEscapeLayer(closeOverlay));

    escapeOn(a.inner);
    expect(closeOverlay).toHaveBeenCalledOnce();
    expect(a.cancel).not.toHaveBeenCalled();
  });

  it('detaches once every composer is released', () => {
    const a = composer();
    const release = registerEnhancingComposer(() => a.container, a.cancel);
    release();
    release();
    escapeOn(a.inner);
    expect(a.cancel).not.toHaveBeenCalled();
  });
});
