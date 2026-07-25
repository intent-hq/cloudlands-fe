/**
 * AuroraBackground cleanup: unmount must fully release GPU resources
 * (buffer, shaders, program) and lose the WebGL context so repeated
 * mount/unmount cycles don't accumulate zombie contexts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import AuroraBackground from '../AuroraBackground.svelte';

vi.mock('$app/environment', () => ({ browser: true }));

vi.mock('$store/renderer/slices/theme/theme-selectors', () => ({
  selectIsDarkTheme: () => ({
    subscribe: (fn: (value: boolean) => void) => {
      fn(false);
      return () => {};
    },
  }),
}));

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
    uniform2f: vi.fn(),
    uniform3f: vi.fn(),
    drawArrays: vi.fn(),
    getExtension: vi.fn((name: string) =>
      name === 'WEBGL_lose_context' ? { loseContext } : null,
    ),
  };
  return { gl, loseContext };
}

describe('AuroraBackground cleanup', () => {
  let mockGL: ReturnType<typeof createMockGL>;
  let getContextSpy: ReturnType<typeof vi.spyOn>;
  let rafCallbacks: FrameRequestCallback[];

  beforeEach(() => {
    mockGL = createMockGL();
    getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation(() => mockGL.gl as unknown as RenderingContext);
    rafCallbacks = [];
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((cb: FrameRequestCallback) => {
        rafCallbacks.push(cb);
        return rafCallbacks.length;
      }),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    cleanup();
    getContextSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  function flushRafCallbacks() {
    const pending = rafCallbacks.splice(0, rafCallbacks.length);
    for (const cb of pending) cb(performance.now());
  }

  it('deletes buffer, shaders, program and loses the context on unmount', () => {
    const { unmount } = render(AuroraBackground, { props: { agentId: 'agent-1' } });

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

    render(AuroraBackground, { props: { agentId: 'agent-1' } });

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
    const { unmount } = render(AuroraBackground, { props: { agentId: 'agent-1' } });
    expect(getContextSpy).toHaveBeenCalledTimes(1);

    unmount();

    // Any re-init scheduled via requestAnimationFrame (e.g. by the $effect
    // that restarts WebGL when gl is null) must be a no-op after destroy.
    flushRafCallbacks();
    flushRafCallbacks();

    expect(getContextSpy).toHaveBeenCalledTimes(1);
    expect(mockGL.loseContext).toHaveBeenCalledTimes(1);
  });
});
