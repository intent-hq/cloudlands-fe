import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vitest';

type EscapeLayersModule = typeof import('../escapeLayers');

let push: EscapeLayersModule['pushEscapeLayer'];
let releases: Array<() => void> = [];

/** Push a layer and record its release so afterEach can drain the stack. */
function pushEscapeLayer(onEscape: () => void): () => void {
  const release = push(onEscape);
  releases.push(release);
  return release;
}

function pressEscape(): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(event);
  return event;
}

describe('escapeLayers', () => {
  beforeEach(async () => {
    // Fresh module per test so the module-level stack/listener state is isolated
    vi.resetModules();
    ({ pushEscapeLayer: push } = await import('../escapeLayers'));
  });

  afterEach(() => {
    // Drain the stack so this module instance detaches its window listener
    releases.forEach((release) => release());
    releases = [];
  });

  it('dispatches Escape only to the topmost layer', () => {
    const bottom = vi.fn();
    const top = vi.fn();
    pushEscapeLayer(bottom);
    pushEscapeLayer(top);

    pressEscape();

    expect(top).toHaveBeenCalledTimes(1);
    expect(bottom).not.toHaveBeenCalled();
  });

  it('falls back to the next layer after the top layer is released (LIFO)', () => {
    const bottom = vi.fn();
    const top = vi.fn();
    pushEscapeLayer(bottom);
    const releaseTop = pushEscapeLayer(top);

    releaseTop();
    pressEscape();

    expect(top).not.toHaveBeenCalled();
    expect(bottom).toHaveBeenCalledTimes(1);
  });

  it('supports releasing a layer from the middle of the stack', () => {
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();
    pushEscapeLayer(a);
    const releaseB = pushEscapeLayer(b);
    pushEscapeLayer(c);

    releaseB();
    pressEscape();
    expect(c).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    expect(a).not.toHaveBeenCalled();
  });

  it('attaches a single capture-phase window listener and detaches it when the stack empties', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const releaseA = pushEscapeLayer(vi.fn());
    const releaseB = pushEscapeLayer(vi.fn());

    const addCalls = addSpy.mock.calls.filter(([type]) => type === 'keydown');
    expect(addCalls).toHaveLength(1);
    expect(addCalls[0]?.[2]).toEqual({ capture: true });

    releaseA();
    expect(removeSpy.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(0);

    releaseB();
    const removeCalls = removeSpy.mock.calls.filter(([type]) => type === 'keydown');
    expect(removeCalls).toHaveLength(1);
    expect(removeCalls[0]?.[2]).toEqual({ capture: true });
  });

  it('calls preventDefault and stopImmediatePropagation on a handled Escape', () => {
    pushEscapeLayer(vi.fn());

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    const stopImmediatePropagationSpy = vi.spyOn(event, 'stopImmediatePropagation');
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(stopImmediatePropagationSpy).toHaveBeenCalledTimes(1);
  });

  it('ignores non-Escape keys', () => {
    const onEscape = vi.fn();
    pushEscapeLayer(onEscape);

    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(onEscape).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('does nothing after all layers are released', () => {
    const onEscape = vi.fn();
    const release = pushEscapeLayer(onEscape);
    release();

    const event = pressEscape();

    expect(onEscape).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('treats double-release as a no-op that does not remove other layers', () => {
    const a = vi.fn();
    const b = vi.fn();
    const releaseA = pushEscapeLayer(a);
    pushEscapeLayer(b);

    releaseA();
    releaseA();
    pressEscape();

    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
  });

  it('keeps layers distinct when the same callback is pushed twice', () => {
    const onEscape = vi.fn();
    const releaseFirst = pushEscapeLayer(onEscape);
    pushEscapeLayer(onEscape);

    releaseFirst();
    pressEscape();

    expect(onEscape).toHaveBeenCalledTimes(1);
  });
});
