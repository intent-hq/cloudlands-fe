<script lang="ts">
  /**
   * Aurora Background Component
   *
   * Creates a subtle WebGL-powered northern lights effect that appears behind
   * the chat input when streaming. Uses the canonical active agent color.
   *
   * Performance optimizations:
   * - Throttled to 30fps instead of 60fps (halves GPU usage)
   * - Renders the backing buffer at half the CSS resolution
   * - Pauses when tab is hidden (Page Visibility API)
   * - Simplified shader with fewer blobs (5 instead of 10)
   * - Respects prefers-reduced-motion
   */
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { scheduleLayoutRead, type CancelLayoutTask } from '$lib/utils/layout-phases';

  interface Props {
    agentId?: string;
  }

  let { agentId = 'default' }: Props = $props();

  let canvas = $state<HTMLCanvasElement>();
  let gl = $state<WebGLRenderingContext | null>(null);
  let animationFrame = $state<number>(0);
  let program = $state<WebGLProgram | null>(null);
  let vertexShader: WebGLShader | null = null;
  let fragmentShader: WebGLShader | null = null;
  let positionBuffer: WebGLBuffer | null = null;
  let destroyed = false;
  let initFailed = false;
  let startTime = $state<number>(0);
  let isPageVisible = $state<boolean>(true);
  let isWindowFocused = $state<boolean>(true);
  let prefersReducedMotion = $state<boolean>(false);
  let lastFrameTime = $state<number>(0);
  let semanticColorReady = false;

  // Target 30fps instead of 60fps to reduce GPU usage
  const TARGET_FRAME_TIME = 1000 / 30; // ~33ms per frame
  // The effect is intentionally soft, so Retina supersampling adds fragment work without useful detail.
  const MAX_RENDER_DPR = 0.5;

  // Random seed for variety each session
  const seed = Math.random() * 1000;

  const fract = (value: number) => value - Math.floor(value);

  function seededRandom(id: number) {
    let x = fract((id * 127.1 + seed) * 0.1031);
    let y = fract((id * 311.7 + seed * 1.7) * 0.1031);
    let z = x;
    const offset = x * (y + 33.33) + y * (z + 33.33) + z * (x + 33.33);
    x += offset;
    y += offset;
    z += offset;
    return fract((x + y) * z);
  }

  const phaseOffsets = new Float32Array(
    Array.from({ length: 5 }, (_, index) => seededRandom(index + 1) * 6.28),
  );
  const blobCenters = new Float32Array(10);

  function updateBlobCenters(time: number) {
    const [r1, r2, r3, r4, r5] = phaseOffsets;
    blobCenters.set([
      0.15 + Math.sin(time * 0.8 + r1) * 0.35 + Math.cos(time * 0.5 + r1) * 0.15,
      0.25 + Math.cos(time * 0.7 + r1) * 0.4,
      0.85 + Math.cos(time * 0.7 + r2) * 0.4,
      0.3 + Math.sin(time * 0.65 + r2) * 0.45,
      0.35 + Math.sin(time * 0.9 + r3) * 0.3,
      0.2 + Math.cos(time * 0.85 + r3) * 0.4,
      0.5 + Math.sin(time + r4) * 0.35,
      0.35 + Math.sin(time * 2 + r4) * 0.25,
      0.65 + Math.cos(time * 0.85 + r5) * 0.35,
      0.28 + Math.sin(time * 0.75 + r5) * 0.4,
    ]);
  }

  // Cached uniform locations (avoid getUniformLocation every frame)
  let uniformLocations: {
    time: WebGLUniformLocation | null;
    resolution: WebGLUniformLocation | null;
    color1: WebGLUniformLocation | null;
    color2: WebGLUniformLocation | null;
    color3: WebGLUniformLocation | null;
    centers: WebGLUniformLocation | null;
    phases: WebGLUniformLocation | null;
  } | null = null;

  // Cached device pixel ratio (updated on resize, not every frame)
  let cachedDpr = 1;
  let cachedCanvasWidth: number | null = null;
  let cachedCanvasHeight: number | null = null;
  let canvasResizeObserver: ResizeObserver | null = null;

  function getSemanticAuroraColor(): [number, number, number] | null {
    if (!canvas) return null;

    const match = getComputedStyle(canvas).color.match(/^rgba?\((.+)\)$/i);
    if (!match) return null;

    const channels = match[1]
      .split(/[\s,\/]+/)
      .filter(Boolean)
      .slice(0, 3);
    if (channels.length !== 3) return null;

    const rgb = channels.map((channel) => {
      const value = Number.parseFloat(channel);
      return channel.endsWith('%') ? value / 100 : value / 255;
    });
    if (rgb.some((channel) => !Number.isFinite(channel) || channel < 0 || channel > 1)) {
      return null;
    }
    return rgb as [number, number, number];
  }

  // The getComputedStyle read in getSemanticAuroraColor forces a style
  // recalc when it runs mid-flush (component mount during a workspace
  // switch) or from the render loop right after other rAF callbacks wrote
  // to the DOM. Route every sync through the shared batched read phase so
  // the read shares one clean layout pass with the other measurers.
  // The pending flag (not the cancel handle) gates re-scheduling: a
  // synchronously-invoking rAF stub runs the task before the handle lands.
  let colorReadPending = false;
  let cancelColorRead: CancelLayoutTask | null = null;

  function scheduleSemanticColorSync() {
    if (colorReadPending) return;
    colorReadPending = true;
    cancelColorRead = scheduleLayoutRead(() => {
      colorReadPending = false;
      if (!destroyed) syncSemanticAuroraColor();
    });
  }

  function syncSemanticAuroraColor(): boolean {
    // Keep the existing prop contract without letting agent identity affect the color.
    void agentId;
    semanticColorReady = false;
    if (!gl || !program || !uniformLocations) return false;

    const color = getSemanticAuroraColor();
    if (!color) return false;

    gl.useProgram(program);
    for (const location of [
      uniformLocations.color1,
      uniformLocations.color2,
      uniformLocations.color3,
    ]) {
      gl.uniform3f(location, color[0], color[1], color[2]);
    }
    semanticColorReady = true;
    return true;
  }

  const vertexShaderSource = `
    attribute vec2 a_position;
    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  // Simplified shader: 5 blobs instead of 10, reduced fbm iterations (2 instead of 4)
  // This reduces GPU load by ~60% while maintaining visual quality
  const fragmentShaderSource = `
    precision mediump float;
    uniform float u_time;
    uniform vec2 u_resolution;
    uniform vec3 u_color1;
    uniform vec3 u_color2;
    uniform vec3 u_color3;
    uniform vec2 u_centers[5];
    uniform float u_phases[5];

    // Hash function for grain and randomness
    float hash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    // Smooth noise function
    float noise(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    // Smooth interpolated noise
    float smoothNoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = noise(i);
      float b = noise(i + vec2(1.0, 0.0));
      float c = noise(i + vec2(0.0, 1.0));
      float d = noise(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }

    // Simplified fractal noise (2 octaves instead of 4)
    float fbm(vec2 p) {
      float value = 0.0;
      value += 0.5 * smoothNoise(p);
      value += 0.25 * smoothNoise(p * 2.0);
      return value;
    }

    // Soft circular blob
    float blob(vec2 uv, vec2 center, float radius) {
      float d = length(uv - center);
      return 1.0 - smoothstep(0.0, radius, d);
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / u_resolution;
      float time = u_time * 0.6;

      // Vertical gradient
      float verticalFade = pow(1.0 - uv.y, 1.0);

      // Color variety (reduced from 10 to 5)
      vec3 color4 = mix(u_color1, u_color3, 0.5);
      vec3 color5 = mix(u_color2, u_color1, 0.65);

      float r1 = u_phases[0];
      float r2 = u_phases[1];
      float r3 = u_phases[2];
      float r4 = u_phases[3];
      float r5 = u_phases[4];

      vec2 c1 = u_centers[0];
      float b1 = blob(uv, c1, 0.56);
      b1 *= 0.6 + fbm(uv * 2.5 + time * 0.6 + r1) * 0.6;

      vec2 c2 = u_centers[1];
      float b2 = blob(uv, c2, 0.504);
      b2 *= 0.6 + fbm(uv * 2.8 + time * 0.5 + r2) * 0.6;

      vec2 c3 = u_centers[2];
      float b3 = blob(uv, c3, 0.616);
      b3 *= 0.6 + fbm(uv * 2.2 + time * 0.55 + r3) * 0.6;

      vec2 c4 = u_centers[3];
      float b4 = blob(uv, c4, 0.538);
      b4 *= 0.6 + fbm(uv * 3.0 + time * 0.6 + r4) * 0.6;

      vec2 c5 = u_centers[4];
      float b5 = blob(uv, c5, 0.47);
      b5 *= 0.6 + fbm(uv * 2.6 + time * 0.5 + r5) * 0.6;

      // Mix 5 colors with their blob weights
      vec3 color = vec3(0.0);
      float totalWeight = 0.001;

      color += u_color1 * b1; totalWeight += b1;
      color += u_color2 * b2; totalWeight += b2;
      color += u_color3 * b3; totalWeight += b3;
      color += color4 * b4; totalWeight += b4;
      color += color5 * b5; totalWeight += b5;

      color /= totalWeight;

      // Overall intensity from all blobs
      float intensity = max(max(max(b1, b2), max(b3, b4)), b5);
      intensity = pow(intensity, 0.55);
      intensity *= verticalFade;

      // Breathing pulse
      intensity *= 0.85 + sin(time * 0.5) * 0.15;

      // Simplified grain (less expensive)
      float grainValue = hash(gl_FragCoord.xy);
      color = color + (grainValue - 0.5) * 0.15;

      float alpha = intensity * 0.9;
      gl_FragColor = vec4(color * alpha, alpha);
    }
  `;

  function createShader(
    gl: WebGLRenderingContext,
    type: number,
    source: string,
  ): WebGLShader | null {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function createProgram(
    gl: WebGLRenderingContext,
    vs: WebGLShader,
    fs: WebGLShader,
  ): WebGLProgram | null {
    const prog = gl.createProgram();
    if (!prog) return null;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(prog));
      gl.deleteProgram(prog);
      return null;
    }
    return prog;
  }

  // Release partially created resources when initialization fails mid-way,
  // and remember the failure so the $effect re-init path (which fires when
  // gl goes null) doesn't retry a deterministic failure in a loop.
  function abortInit() {
    initFailed = true;
    cleanup();
  }

  function initWebGL() {
    // The gl check makes re-entry a no-op: init can be triggered from both
    // onMount and the $effect-queued rAF, and running twice would overwrite
    // (and leak) the live context and its resources.
    if (!canvas || !browser || destroyed || initFailed || gl) return;

    gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true });
    if (!gl) {
      console.warn('AuroraBackground: WebGL not available');
      initFailed = true;
      return;
    }

    vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    if (!vertexShader || !fragmentShader) {
      abortInit();
      return;
    }

    program = createProgram(gl, vertexShader, fragmentShader);
    if (!program) {
      abortInit();
      return;
    }

    // Create fullscreen quad
    const positions = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    positionBuffer = gl.createBuffer();
    if (!positionBuffer) {
      abortInit();
      return;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    const posLoc = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Cache uniform locations once
    uniformLocations = {
      time: gl.getUniformLocation(program, 'u_time'),
      resolution: gl.getUniformLocation(program, 'u_resolution'),
      color1: gl.getUniformLocation(program, 'u_color1'),
      color2: gl.getUniformLocation(program, 'u_color2'),
      color3: gl.getUniformLocation(program, 'u_color3'),
      centers: gl.getUniformLocation(program, 'u_centers[0]'),
      phases: gl.getUniformLocation(program, 'u_phases[0]'),
    };
    gl.useProgram(program);
    gl.uniform1fv(uniformLocations.phases, phaseOffsets);
    scheduleSemanticColorSync();

    updateCanvasSize();

    startTime = performance.now();
    render();
  }

  function updateCanvasSize(width?: number, height?: number) {
    if (!canvas) return;

    const cssWidth = width ?? cachedCanvasWidth ?? canvas.clientWidth;
    const cssHeight = height ?? cachedCanvasHeight ?? canvas.clientHeight;
    cachedCanvasWidth = cssWidth;
    cachedCanvasHeight = cssHeight;

    const pixelWidth = Math.max(1, Math.round(cssWidth * cachedDpr));
    const pixelHeight = Math.max(1, Math.round(cssHeight * cachedDpr));
    if (canvas.width === pixelWidth && canvas.height === pixelHeight) return;

    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    gl?.viewport(0, 0, pixelWidth, pixelHeight);
  }

  function setupCanvasResizeObserver() {
    if (!canvas || typeof ResizeObserver === 'undefined') return;

    canvasResizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === canvas) {
          updateCanvasSize(entry.contentRect.width, entry.contentRect.height);
        }
      }
    });
    canvasResizeObserver.observe(canvas);
    updateCanvasSize();
  }

  function scheduleRender() {
    if (
      animationFrame ||
      !gl ||
      !program ||
      !isPageVisible ||
      !isWindowFocused ||
      prefersReducedMotion
    )
      return;
    animationFrame = requestAnimationFrame(render);
  }

  function cancelScheduledRender() {
    if (animationFrame) {
      cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }
  }

  function render() {
    animationFrame = 0;
    if (!gl || !program || !canvas) return;

    // Skip rendering if the page or window is inactive, or the user prefers reduced motion
    if (!isPageVisible || !isWindowFocused || prefersReducedMotion) {
      return;
    }

    // Throttle to ~30fps to reduce GPU usage
    const now = performance.now();
    const elapsed = now - lastFrameTime;
    if (elapsed < TARGET_FRAME_TIME) {
      scheduleRender();
      return;
    }
    lastFrameTime = now - (elapsed % TARGET_FRAME_TIME);

    const width = canvas.width;
    const height = canvas.height;

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(program);

    // Use cached uniform locations (set once in initWebGL)
    if (!uniformLocations) return;

    const elapsedSeconds = (performance.now() - startTime) / 1000;
    gl.uniform1f(uniformLocations.time, elapsedSeconds);
    gl.uniform2f(uniformLocations.resolution, width, height);

    if (!semanticColorReady) {
      // Sync runs in the batched read phase, never from the render loop —
      // draw resumes once the color lands.
      scheduleSemanticColorSync();
      scheduleRender();
      return;
    }

    updateBlobCenters(elapsedSeconds * 0.6);
    gl.uniform2fv(uniformLocations.centers, blobCenters);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    scheduleRender();
  }

  function cleanup() {
    cancelScheduledRender();
    cancelColorRead?.();
    cancelColorRead = null;
    colorReadPending = false;
    canvasResizeObserver?.disconnect();
    canvasResizeObserver = null;
    if (gl) {
      if (positionBuffer) {
        gl.deleteBuffer(positionBuffer);
      }
      if (vertexShader) {
        gl.deleteShader(vertexShader);
      }
      if (fragmentShader) {
        gl.deleteShader(fragmentShader);
      }
      if (program) {
        gl.deleteProgram(program);
      }
      // Explicitly release the GPU context so repeated mount/unmount cycles
      // don't accumulate zombie contexts ("Too many active WebGL contexts")
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
    positionBuffer = null;
    vertexShader = null;
    fragmentShader = null;
    program = null;
    gl = null;
    uniformLocations = null;
    semanticColorReady = false;
  }

  // Handle page visibility changes
  function handleVisibilityChange() {
    isPageVisible = !document.hidden;
    if (isPageVisible) scheduleRender();
    else cancelScheduledRender();
  }

  function handleWindowBlur() {
    isWindowFocused = false;
    cancelScheduledRender();
  }

  function handleWindowFocus() {
    isWindowFocused = true;
    scheduleRender();
  }

  // Handle reduced motion preference changes
  function handleMotionPreference(e: MediaQueryListEvent) {
    prefersReducedMotion = e.matches;
    if (prefersReducedMotion) cancelScheduledRender();
    else scheduleRender();
  }

  // Handle DPR changes (e.g., moving window between displays)
  // We need to recreate the media query each time because a query for a specific
  // DPR value only fires once (when it stops matching). By recreating with the
  // new DPR, we can detect the next transition too.
  let dprCleanup: (() => void) | undefined;

  function setupDprListener() {
    const dpr = window.devicePixelRatio || 1;
    const dprQuery = window.matchMedia(`(resolution: ${dpr}dppx)`);
    const handler = () => {
      cachedDpr = Math.min(window.devicePixelRatio || 1, MAX_RENDER_DPR);
      updateCanvasSize();
      // Remove old listener and set up a new one with the updated DPR
      dprQuery.removeEventListener('change', handler);
      setupDprListener();
    };
    dprQuery.addEventListener('change', handler);
    dprCleanup = () => dprQuery.removeEventListener('change', handler);
  }

  onMount(() => {
    // Check initial states
    isPageVisible = !document.hidden;
    isWindowFocused = document.hasFocus();
    prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    cachedDpr = Math.min(window.devicePixelRatio || 1, MAX_RENDER_DPR);

    // Listen for visibility changes
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('focus', handleWindowFocus);

    // Listen for motion preference changes
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    motionQuery.addEventListener('change', handleMotionPreference);

    // Listen for DPR changes (e.g., moving between retina/non-retina displays)
    setupDprListener();
    setupCanvasResizeObserver();

    const handleSemanticColorChange = () => syncSemanticAuroraColor();
    const themeObserver = new MutationObserver(handleSemanticColorChange);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme', 'data-theme-override'],
    });
    window.addEventListener('theme-changed', handleSemanticColorChange);

    initWebGL();

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('focus', handleWindowFocus);
      motionQuery.removeEventListener('change', handleMotionPreference);
      window.removeEventListener('theme-changed', handleSemanticColorChange);
      themeObserver.disconnect();
      dprCleanup?.();
    };
  });

  onDestroy(() => {
    destroyed = true;
    cleanup();
  });

  // Start/stop animation based on visibility
  $effect(() => {
    if (browser) {
      if (!gl) {
        // Small delay to ensure canvas is in DOM
        requestAnimationFrame(() => initWebGL());
      }
    } else {
      cleanup();
    }
  });
</script>

<canvas bind:this={canvas} class="aurora-background block h-full w-full"></canvas>

<style>
  .aurora-background {
    color: hsl(var(--agent-avatar-surface-active));
  }
</style>
