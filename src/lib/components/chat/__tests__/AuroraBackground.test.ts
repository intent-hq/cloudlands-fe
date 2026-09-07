/**
 * AuroraBackground cleanup: unmount must fully release GPU resources
 * (buffer, shaders, program) and lose the WebGL context so repeated
 * mount/unmount cycles don't accumulate zombie contexts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import AuroraBackground from '../AuroraBackground.svelte';

vi.mock('$app/environment', () => ({ browser: true }));

function createMockGL() {
  const loseContext = vi.fn();
  const gl = {
    VERTEX_SHADER: 35633,
    FRAGMENT_SHADER: 35632,
    COMPILE_STATUS: 35713,
    LINK_STATUS: 35714,
    ARRAY_BUFFER: 34962,
    STATIC_DRAW: 35044,
    FLOAT: 5126,
    BLEND: 3042,
    SRC_ALPHA: 770,
    ONE_MINUS_SRC_ALPHA: 771,
    COLOR_BUFFER_BIT: 16384,
    TRIANGLE_STRIP: 5,
    createShader: vi.fn((type: number) => ({ shaderType: type })),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => ''),
    deleteShader: vi.fn(),
    createProgram: vi.fn(() => ({ isProgram: true })),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    getProgramInfoLog: vi.fn(() => ''),
    deleteProgram: vi.fn(),
    createBuffer: vi.fn(() => ({ isBuffer: true })),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    deleteBuffer: vi.fn(),
    getAttribLocation: vi.fn(() => 0),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    enable: vi.fn(),
    blendFunc: vi.fn(),
    getUniformLocation: vi.fn(() => ({})),
    viewport: vi.fn(),
    clearColor: vi.fn(),
    clear: vi.fn(),
    useProgram: vi.fn(),
    uniform1f: vi.fn(),
    uniform1fv: vi.fn(),
    uniform2f: vi.fn(),
    uniform2fv: vi.fn(),
    uniform3f: vi.fn(),
    drawArrays: vi.fn(),
    getExtension: vi.fn((name: string) => (name === 'WEBGL_lose_context' ? { loseContext } : null)),
  };
  return { gl, loseContext };
}

class MockResizeObserver {
  static instances: MockResizeObserver[] = [];
  constructor(private readonly callback: ResizeObserverCallback) {
    MockResizeObserver.instances.push(this);
  }
  observe() {}
  disconnect() {}
  fire(width: number, height: number) {
    this.callback(
      [
        {
          target: document.querySelector('canvas')!,
          contentRect: { width, height },
        } as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver,
    );
  }
}

describe('AuroraBackground cleanup', () => {
  let mockGL: ReturnType<typeof createMockGL>;
  let getContextSpy: ReturnType<typeof vi.spyOn>;
  let getComputedStyleSpy: ReturnType<typeof vi.spyOn>;
  let rafCallbacks: FrameRequestCallback[];
  let computedAuroraColor: string;
  let originalRootClass: string;
  let originalRootStyle: string;
  let originalWindowBlurred: boolean;

  beforeEach(() => {
    originalRootClass = document.documentElement.className;
    originalRootStyle = document.documentElement.style.cssText;
    originalWindowBlurred = document.documentElement.hasAttribute('data-window-blurred');
    document.documentElement.removeAttribute('data-window-blurred');
    computedAuroraColor = 'rgb(202, 213, 91)';
    mockGL = createMockGL();
    getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation(() => mockGL.gl as unknown as RenderingContext);
    const getComputedStyle = window.getComputedStyle.bind(window);
    getComputedStyleSpy = vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      if (element instanceof HTMLCanvasElement) {
        return { color: computedAuroraColor } as CSSStyleDeclaration;
      }
      return getComputedStyle(element);
    });
    rafCallbacks = [];
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((cb: FrameRequestCallback) => {
        rafCallbacks.push(cb);
        return rafCallbacks.length;
      }),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
    MockResizeObserver.instances = [];
  });

  afterEach(() => {
    cleanup();
    document.documentElement.className = originalRootClass;
    document.documentElement.style.cssText = originalRootStyle;
    document.documentElement.toggleAttribute('data-window-blurred', originalWindowBlurred);
    getContextSpy.mockRestore();
    getComputedStyleSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  function flushRafCallbacks() {
    const pending = rafCallbacks.splice(0, rafCallbacks.length);
    for (const cb of pending) cb(performance.now());
  }

  function uniformColors() {
    return mockGL.gl.uniform3f.mock.calls
      .slice(-3)
      .map(([, red, green, blue]) => [red, green, blue]);
  }

  it('deletes buffer, shaders, program and loses the context on unmount', () => {
    const { unmount } = render(AuroraBackground);

    expect(getContextSpy).toHaveBeenCalledTimes(1);
    expect(mockGL.gl.createShader).toHaveBeenCalledTimes(2);
    expect(mockGL.gl.createProgram).toHaveBeenCalledTimes(1);
    expect(mockGL.gl.createBuffer).toHaveBeenCalledTimes(1);

    unmount();

    expect(mockGL.gl.deleteBuffer).toHaveBeenCalledWith({ isBuffer: true });
    expect(mockGL.gl.deleteShader).toHaveBeenCalledWith({ shaderType: 35633 });
    expect(mockGL.gl.deleteShader).toHaveBeenCalledWith({ shaderType: 35632 });
    expect(mockGL.gl.deleteProgram).toHaveBeenCalledWith({ isProgram: true });
    expect(mockGL.gl.getExtension).toHaveBeenCalledWith('WEBGL_lose_context');
    expect(mockGL.loseContext).toHaveBeenCalledTimes(1);
  });

  it('releases the context and does not retry when shader compilation fails', () => {
    mockGL.gl.getShaderParameter.mockReturnValue(false);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(AuroraBackground);

    expect(getContextSpy).toHaveBeenCalledTimes(1);
    // Partial init must not leave a live context behind
    expect(mockGL.loseContext).toHaveBeenCalledTimes(1);

    // The failure must not trigger an init retry loop via the $effect
    flushRafCallbacks();
    flushRafCallbacks();
    expect(getContextSpy).toHaveBeenCalledTimes(1);
    expect(mockGL.loseContext).toHaveBeenCalledTimes(1);
  });

  it('does not re-initialize WebGL after destroy', () => {
    const { unmount } = render(AuroraBackground);
    expect(getContextSpy).toHaveBeenCalledTimes(1);

    unmount();

    // Any re-init scheduled via requestAnimationFrame (e.g. by the $effect
    // that restarts WebGL when gl is null) must be a no-op after destroy.
    flushRafCallbacks();
    flushRafCallbacks();

    expect(getContextSpy).toHaveBeenCalledTimes(1);
    expect(mockGL.loseContext).toHaveBeenCalledTimes(1);
  });

  it('uses five blobs with radii increased by about twelve percent', () => {
    render(AuroraBackground);

    const fragmentSource = mockGL.gl.shaderSource.mock.calls
      .map(([, source]) => String(source))
      .find((source) => source.includes('precision mediump float'));
    expect(fragmentSource).toBeDefined();

    const radii = Array.from(
      fragmentSource!.matchAll(/float b[1-5] = blob\(uv, c[1-5], ([0-9.]+)\);/g),
      (match) => Number(match[1]),
    );
    const previousRadii = [0.5, 0.45, 0.55, 0.48, 0.42];

    expect(radii).toHaveLength(5);
    radii.forEach((radius, index) => {
      expect(radius / previousRadii[index]).toBeGreaterThanOrEqual(1.11);
      expect(radius / previousRadii[index]).toBeLessThanOrEqual(1.13);
    });
    expect(fragmentSource).toContain('float alpha = intensity * 0.9;');
  });

  it('sets every shader color to the computed active surface on initial mount', () => {
    render(AuroraBackground);

    // The mount-time color sync is deferred to the batched layout read phase
    // (one rAF) instead of forcing a style recalc synchronously.
    expect(mockGL.gl.uniform3f).not.toHaveBeenCalled();
    flushRafCallbacks();

    const expected = [202 / 255, 213 / 255, 91 / 255];
    expect(uniformColors()).toEqual([expected, expected, expected]);
  });

  it('updates every shader color after live theme and semantic token changes', async () => {
    render(AuroraBackground);
    mockGL.gl.uniform3f.mockClear();

    computedAuroraColor = 'rgb(173, 197, 116)';
    document.documentElement.classList.toggle('dark');
    await vi.waitFor(() => expect(mockGL.gl.uniform3f).toHaveBeenCalledTimes(3));
    const dark = [173 / 255, 197 / 255, 116 / 255];
    expect(uniformColors()).toEqual([dark, dark, dark]);

    mockGL.gl.uniform3f.mockClear();
    computedAuroraColor = 'rgb(227, 180, 31)';
    window.dispatchEvent(new CustomEvent('theme-changed'));
    const liveTheme = [227 / 255, 180 / 255, 31 / 255];
    expect(uniformColors()).toEqual([liveTheme, liveTheme, liveTheme]);

    mockGL.gl.uniform3f.mockClear();
    computedAuroraColor = 'rgb(91, 122, 219)';
    document.documentElement.style.setProperty('--agent-avatar-surface-active', '225 63% 61%');
    await vi.waitFor(() => expect(mockGL.gl.uniform3f).toHaveBeenCalledTimes(3));
    const customToken = [91 / 255, 122 / 255, 219 / 255];
    expect(uniformColors()).toEqual([customToken, customToken, customToken]);
  });

  it('does not draw an unrelated fallback while the semantic color is unresolved', async () => {
    computedAuroraColor = 'CanvasText';
    render(AuroraBackground);

    expect(mockGL.gl.uniform3f).not.toHaveBeenCalled();
    expect(mockGL.gl.drawArrays).not.toHaveBeenCalled();

    computedAuroraColor = 'rgb(202, 213, 91)';
    document.documentElement.style.setProperty('--agent-avatar-surface-active', '67 72% 60%');
    await vi.waitFor(() => expect(mockGL.gl.uniform3f).toHaveBeenCalledTimes(3));
  });

  it('keeps drawing throttled to the 30 fps budget', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    render(AuroraBackground);
    expect(mockGL.gl.drawArrays).not.toHaveBeenCalled();

    now.mockReturnValue(10);
    flushRafCallbacks();
    now.mockReturnValue(20);
    flushRafCallbacks();
    expect(mockGL.gl.drawArrays).not.toHaveBeenCalled();

    now.mockReturnValue(34);
    flushRafCallbacks();
    expect(mockGL.gl.drawArrays).toHaveBeenCalledTimes(1);
    now.mockRestore();
  });

  it('uploads stable phases once and moving centers for each drawn frame', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    render(AuroraBackground);

    expect(mockGL.gl.uniform1fv).toHaveBeenCalledTimes(1);
    expect(Array.from(mockGL.gl.uniform1fv.mock.calls[0][1])).toHaveLength(5);

    now.mockReturnValue(34);
    flushRafCallbacks();
    expect(mockGL.gl.drawArrays).toHaveBeenCalledTimes(1);
    expect(mockGL.gl.uniform2fv).toHaveBeenCalledTimes(1);
    const firstCenters = Array.from(mockGL.gl.uniform2fv.mock.calls[0][1]);

    now.mockReturnValue(68);
    flushRafCallbacks();
    expect(mockGL.gl.drawArrays).toHaveBeenCalledTimes(2);
    expect(mockGL.gl.uniform2fv).toHaveBeenCalledTimes(2);
    const secondCenters = Array.from(mockGL.gl.uniform2fv.mock.calls[1][1]);

    expect(firstCenters).toHaveLength(10);
    expect(secondCenters).not.toEqual(firstCenters);
    expect(mockGL.gl.uniform1fv).toHaveBeenCalledTimes(1);
    now.mockRestore();
  });

  it('stops drawing when the shared window-blurred attribute is added', async () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    render(AuroraBackground);

    now.mockReturnValue(34);
    flushRafCallbacks();
    expect(mockGL.gl.drawArrays).toHaveBeenCalledTimes(1);

    document.documentElement.setAttribute('data-window-blurred', '');
    await vi.waitFor(() => expect(cancelAnimationFrame).toHaveBeenCalledTimes(1));
    flushRafCallbacks();
    expect(mockGL.gl.drawArrays).toHaveBeenCalledTimes(1);
    expect(rafCallbacks).toHaveLength(0);

    now.mockRestore();
  });

  it('resumes drawing when the shared window-blurred attribute is removed', async () => {
    document.documentElement.setAttribute('data-window-blurred', '');
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    render(AuroraBackground);

    flushRafCallbacks();
    expect(mockGL.gl.drawArrays).not.toHaveBeenCalled();
    expect(rafCallbacks).toHaveLength(0);

    now.mockReturnValue(34);
    document.documentElement.removeAttribute('data-window-blurred');
    await vi.waitFor(() => expect(rafCallbacks).toHaveLength(1));
    flushRafCallbacks();
    expect(mockGL.gl.drawArrays).toHaveBeenCalledTimes(1);
    expect(rafCallbacks).toHaveLength(1);

    now.mockRestore();
  });

  it('keeps drawing after DOM window blur while the shared signal stays focused', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    render(AuroraBackground);

    now.mockReturnValue(34);
    flushRafCallbacks();
    expect(mockGL.gl.drawArrays).toHaveBeenCalledTimes(1);

    now.mockReturnValue(68);
    window.dispatchEvent(new Event('blur'));
    flushRafCallbacks();
    expect(mockGL.gl.drawArrays).toHaveBeenCalledTimes(2);
    expect(rafCallbacks).toHaveLength(1);

    now.mockRestore();
  });

  it('caps Retina backing work across common sizes without frame layout reads', () => {
    const devicePixelRatio = vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(2);
    const clientWidth = vi
      .spyOn(HTMLCanvasElement.prototype, 'clientWidth', 'get')
      .mockReturnValue(0);
    const clientHeight = vi
      .spyOn(HTMLCanvasElement.prototype, 'clientHeight', 'get')
      .mockReturnValue(0);
    render(AuroraBackground);

    expect(clientWidth).toHaveBeenCalledTimes(1);
    expect(clientHeight).toHaveBeenCalledTimes(1);
    flushRafCallbacks();
    expect(clientWidth).toHaveBeenCalledTimes(1);
    expect(clientHeight).toHaveBeenCalledTimes(1);

    const canvas = document.querySelector('canvas')!;
    for (const [width, height] of [
      [320, 180],
      [640, 360],
      [1440, 360],
    ]) {
      MockResizeObserver.instances[0].fire(width, height);
      expect(mockGL.gl.viewport).toHaveBeenLastCalledWith(0, 0, width / 2, height / 2);
      expect([canvas.width, canvas.height]).toEqual([width / 2, height / 2]);
      expect(canvas.width * canvas.height).toBe((width * height) / 4);
    }
    expect(clientWidth).toHaveBeenCalledTimes(1);
    expect(clientHeight).toHaveBeenCalledTimes(1);

    MockResizeObserver.instances[0].fire(640.25, 360.25);
    expect(mockGL.gl.viewport).toHaveBeenLastCalledWith(0, 0, 320, 180);
    expect([canvas.width, canvas.height]).toEqual([320, 180]);

    mockGL.gl.viewport.mockClear();
    MockResizeObserver.instances[0].fire(640.25, 360.25);
    expect(mockGL.gl.viewport).not.toHaveBeenCalled();

    MockResizeObserver.instances[0].fire(0, 0);
    expect(mockGL.gl.viewport).toHaveBeenLastCalledWith(0, 0, 1, 1);
    expect([canvas.width, canvas.height]).toEqual([1, 1]);

    devicePixelRatio.mockRestore();
    clientWidth.mockRestore();
    clientHeight.mockRestore();
  });

  it('does not draw frames when reduced motion is requested', () => {
    vi.mocked(window.matchMedia).mockImplementation(
      (query) =>
        ({
          matches: query === '(prefers-reduced-motion: reduce)',
          media: query,
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          addListener: vi.fn(),
          removeListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }) as MediaQueryList,
    );

    render(AuroraBackground);
    flushRafCallbacks();

    expect(mockGL.gl.drawArrays).not.toHaveBeenCalled();
    expect(rafCallbacks).toHaveLength(0);
  });
});
