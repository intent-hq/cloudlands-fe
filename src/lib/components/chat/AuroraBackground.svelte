<script lang="ts">
  /**
   * Aurora Background Component
   *
   * Creates a subtle WebGL-powered northern lights effect that appears behind
   * the chat input when streaming. Uses colors from the AuggieAvatar palette
   * seeded by the agent ID for consistency.
   *
   * Performance optimizations:
   * - Throttled to 30fps instead of 60fps (halves GPU usage)
   * - Pauses when tab is hidden (Page Visibility API)
   * - Simplified shader with fewer blobs (5 instead of 10)
   * - Respects prefers-reduced-motion
   */
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { colors } from '$lib/components/ui/auggie-avatar/avatar-constants';
  import { stringToSeededRandom } from '$lib/utils/hash';
  import { selectIsDarkTheme } from '$lib/store/slices/theme/theme-selectors';

  interface Props {
    agentId?: string;
  }

  let { agentId = 'default' }: Props = $props();

  let canvas = $state<HTMLCanvasElement>();
  let gl = $state<WebGLRenderingContext | null>(null);
  let animationFrame = $state<number>(0);
  let program = $state<WebGLProgram | null>(null);
  let startTime = $state<number>(0);
  let isPageVisible = $state<boolean>(true);
  let prefersReducedMotion = $state<boolean>(false);
  let lastFrameTime = $state<number>(0);
  const isDarkTheme = selectIsDarkTheme();

  // Target 30fps instead of 60fps to reduce GPU usage
  const TARGET_FRAME_TIME = 1000 / 30; // ~33ms per frame

  // Random seed for variety each session
  const seed = Math.random() * 1000;

  // Cached uniform locations (avoid getUniformLocation every frame)
  let uniformLocations: {
    time: WebGLUniformLocation | null;
    resolution: WebGLUniformLocation | null;
    color1: WebGLUniformLocation | null;
    color2: WebGLUniformLocation | null;
    color3: WebGLUniformLocation | null;
    seed: WebGLUniformLocation | null;
  } | null = null;

  // Cached RGB color values (recomputed only when agentId or dark mode changes)
  let cachedRgbColors: { rgb1: [number, number, number]; rgb2: [number, number, number]; rgb3: [number, number, number] } | null = null;
  let cachedColorKey = '';

  // Cached device pixel ratio (updated on resize, not every frame)
  let cachedDpr = 1;

  // Hue shift a color by degrees (same logic as avatar-constants.ts)
  function hueShiftColor(hexColor: string, hueShift: number): string {
    const match = hexColor.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!match) return hexColor;

    const [, rHex, gHex, bHex] = match;
    const r = parseInt(rHex, 16) / 255;
    const g = parseInt(gHex, 16) / 255;
    const b = parseInt(bHex, 16) / 255;

    // RGB to HSL
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r:
          h = (g - b) / d + (g < b ? 6 : 0);
          break;
        case g:
          h = (b - r) / d + 2;
          break;
        case b:
          h = (r - g) / d + 4;
          break;
      }
      h /= 6;
    }

    // Apply hue shift
    h = (h + hueShift / 360) % 1;
    if (h < 0) h += 1;

    // HSL to RGB
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    let newR, newG, newB;
    if (s === 0) {
      newR = newG = newB = l;
    } else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      newR = hue2rgb(p, q, h + 1 / 3);
      newG = hue2rgb(p, q, h);
      newB = hue2rgb(p, q, h - 1 / 3);
    }

    const toHex = (c: number) =>
      Math.round(c * 255)
        .toString(16)
        .padStart(2, '0');
    return `#${toHex(newR)}${toHex(newG)}${toHex(newB)}`;
  }

  // Generate colors based on agent ID seed - pick one base color and hue shift
  function getAuroraColors(seed: string): [string, string, string] {
    const random = stringToSeededRandom(seed);
    const baseColor = random.pick(colors);
    // Small hue shifts to keep colors in similar range (like avatar does with 30deg)
    const color2 = hueShiftColor(baseColor, 15);
    const color3 = hueShiftColor(baseColor, -10);
    return [baseColor, color2, color3];
  }

  // Convert hex to RGB array (0-1 range) with dark mode adjustments
  // Uses same treatment as avatar: darken to 65% brightness, reduce saturation to 50%
  function hexToRgb(hex: string, darkMode: boolean): [number, number, number] {
    const match = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!match) return [1, 1, 1];

    let r = parseInt(match[1], 16) / 255;
    let g = parseInt(match[2], 16) / 255;
    let b = parseInt(match[3], 16) / 255;

    // Convert RGB to HSL
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    let l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r:
          h = (g - b) / d + (g < b ? 6 : 0);
          break;
        case g:
          h = (b - r) / d + 2;
          break;
        case b:
          h = (r - g) / d + 4;
          break;
      }
      h /= 6;
    }

    if (darkMode) {
      // Same as avatar: reduce saturation to 90%
      s = Math.min(1, Math.max(0, s * 0.9));
    }

    // Also dim the overall effect
    const dimFactor = darkMode ? 0.7 : 1.0;

    // Convert HSL back to RGB
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    let newR, newG, newB;
    if (s === 0) {
      newR = newG = newB = l;
    } else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      newR = hue2rgb(p, q, h + 1 / 3);
      newG = hue2rgb(p, q, h);
      newB = hue2rgb(p, q, h - 1 / 3);
    }

    return [newR * dimFactor, newG * dimFactor, newB * dimFactor];
  }

  let auroraColors = $derived(getAuroraColors(agentId));

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
    uniform float u_seed;

    // Hash function for grain and randomness
    float hash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    // Seeded random - different each session
    float rand(float id) {
      return hash(vec2(id * 127.1 + u_seed, id * 311.7 + u_seed * 1.7));
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

      // Random offsets per blob for variety each session
      float r1 = rand(1.0) * 6.28;
      float r2 = rand(2.0) * 6.28;
      float r3 = rand(3.0) * 6.28;
      float r4 = rand(4.0) * 6.28;
      float r5 = rand(5.0) * 6.28;

      // Blob 1 - circular, big movement
      vec2 c1 = vec2(
        0.15 + sin(time * 0.8 + r1) * 0.35 + cos(time * 0.5 + r1) * 0.15,
        0.25 + cos(time * 0.7 + r1) * 0.4
      );
      float b1 = blob(uv, c1, 0.5);
      b1 *= 0.6 + fbm(uv * 2.5 + time * 0.6 + r1) * 0.6;

      // Blob 2 - sweeps across
      vec2 c2 = vec2(
        0.85 + cos(time * 0.7 + r2) * 0.4,
        0.3 + sin(time * 0.65 + r2) * 0.45
      );
      float b2 = blob(uv, c2, 0.45);
      b2 *= 0.6 + fbm(uv * 2.8 + time * 0.5 + r2) * 0.6;

      // Blob 3 - circular orbit
      vec2 c3 = vec2(
        0.35 + sin(time * 0.9 + r3) * 0.3,
        0.2 + cos(time * 0.85 + r3) * 0.4
      );
      float b3 = blob(uv, c3, 0.55);
      b3 *= 0.6 + fbm(uv * 2.2 + time * 0.55 + r3) * 0.6;

      // Blob 4 - figure 8 motion
      vec2 c4 = vec2(
        0.5 + sin(time * 1.0 + r4) * 0.35,
        0.35 + sin(time * 2.0 + r4) * 0.25
      );
      float b4 = blob(uv, c4, 0.48);
      b4 *= 0.6 + fbm(uv * 3.0 + time * 0.6 + r4) * 0.6;

      // Blob 5 - opposite phase
      vec2 c5 = vec2(
        0.65 + cos(time * 0.85 + r5) * 0.35,
        0.28 + sin(time * 0.75 + r5) * 0.4
      );
      float b5 = blob(uv, c5, 0.42);
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
      float grainValue = hash(gl_FragCoord.xy * 0.5);
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

  function initWebGL() {
    if (!canvas || !browser) return;

    gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true });
    if (!gl) {
      console.warn('AuroraBackground: WebGL not available');
      return;
    }

    const vs = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fs = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    if (!vs || !fs) return;

    program = createProgram(gl, vs, fs);
    if (!program) return;

    // Create fullscreen quad
    const positions = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    const posLoc = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Cache uniform locations once (avoids 6x getUniformLocation calls per frame)
    uniformLocations = {
      time: gl.getUniformLocation(program, 'u_time'),
      resolution: gl.getUniformLocation(program, 'u_resolution'),
      color1: gl.getUniformLocation(program, 'u_color1'),
      color2: gl.getUniformLocation(program, 'u_color2'),
      color3: gl.getUniformLocation(program, 'u_color3'),
      seed: gl.getUniformLocation(program, 'u_seed'),
    };

    // Cache initial DPR
    cachedDpr = window.devicePixelRatio || 1;

    startTime = performance.now();
    render();
  }

  function render() {
    if (!gl || !program || !canvas) return;

    // Skip rendering if page is hidden or user prefers reduced motion
    if (!isPageVisible || prefersReducedMotion) {
      // Still schedule next frame to check visibility
      animationFrame = requestAnimationFrame(render);
      return;
    }

    // Throttle to ~30fps to reduce GPU usage
    const now = performance.now();
    const elapsed = now - lastFrameTime;
    if (elapsed < TARGET_FRAME_TIME) {
      animationFrame = requestAnimationFrame(render);
      return;
    }
    lastFrameTime = now - (elapsed % TARGET_FRAME_TIME);

    // Use cached DPR instead of reading window.devicePixelRatio every frame
    const width = canvas.clientWidth * cachedDpr;
    const height = canvas.clientHeight * cachedDpr;

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    }

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(program);

    // Use cached uniform locations (set once in initWebGL)
    if (!uniformLocations) return;

    gl.uniform1f(uniformLocations.time, (performance.now() - startTime) / 1000);
    gl.uniform2f(uniformLocations.resolution, width, height);
    gl.uniform1f(uniformLocations.seed, seed);

    // Use cached RGB colors (recomputed only when agentId or dark mode changes)
    const colorKey = `${agentId}-${$isDarkTheme}`;
    if (cachedColorKey !== colorKey) {
      const [c1, c2, c3] = auroraColors;
      cachedRgbColors = {
        rgb1: hexToRgb(c1, $isDarkTheme),
        rgb2: hexToRgb(c2, $isDarkTheme),
        rgb3: hexToRgb(c3, $isDarkTheme),
      };
      cachedColorKey = colorKey;
    }
    if (cachedRgbColors) {
      gl.uniform3f(uniformLocations.color1, cachedRgbColors.rgb1[0], cachedRgbColors.rgb1[1], cachedRgbColors.rgb1[2]);
      gl.uniform3f(uniformLocations.color2, cachedRgbColors.rgb2[0], cachedRgbColors.rgb2[1], cachedRgbColors.rgb2[2]);
      gl.uniform3f(uniformLocations.color3, cachedRgbColors.rgb3[0], cachedRgbColors.rgb3[1], cachedRgbColors.rgb3[2]);
    }

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    animationFrame = requestAnimationFrame(render);
  }

  function cleanup() {
    if (animationFrame) {
      cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }
    if (gl && program) {
      gl.deleteProgram(program);
      program = null;
    }
    gl = null;
    uniformLocations = null;
    cachedRgbColors = null;
    cachedColorKey = '';

  }

  // Handle page visibility changes
  function handleVisibilityChange() {
    isPageVisible = !document.hidden;
  }

  // Handle reduced motion preference changes
  function handleMotionPreference(e: MediaQueryListEvent) {
    prefersReducedMotion = e.matches;
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
      cachedDpr = window.devicePixelRatio || 1;
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
    prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Listen for visibility changes
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Listen for motion preference changes
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    motionQuery.addEventListener('change', handleMotionPreference);

    // Listen for DPR changes (e.g., moving between retina/non-retina displays)
    setupDprListener();

    initWebGL();

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      motionQuery.removeEventListener('change', handleMotionPreference);
      dprCleanup?.();
    };
  });

  onDestroy(() => {
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

<canvas bind:this={canvas} class="w-full h-full block"></canvas>
