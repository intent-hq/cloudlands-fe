import * as THREE from 'three';
import { prefersReducedMotion, spring } from '$lib/motion';
import { onReducedMotionChange } from '$lib/utils/reduced-motion';
import type { CityModel } from './home-city-model';
import { CITY_BLOCK_SIZE, cityDistrictBounds, type CityLayout } from './home-city-layout';
import { CityArt, type CityTheme } from './city-art';
import { CitySpriteAtlas, loadCitySpriteSheets } from './city-sprite-art';

interface CityLabel {
  id: string;
  x: number;
  y: number;
  visible: boolean;
}
export interface CityFrame {
  buildings: CityLabel[];
  zoom: number;
  draws: number;
  triangles: number;
  moving: boolean;
  yaw: number;
  elevation: number;
}
interface CameraView {
  x: number;
  y: number;
  z: number;
  span: number;
  yaw: number;
  elevation: number;
}
interface CityPointer {
  x: number;
  y: number;
  startX: number;
  startY: number;
  moved: boolean;
  orbit: boolean;
  selectable: boolean;
  label: HTMLElement | null;
}
const DEFAULT_YAW = Math.PI / 4;
const DEFAULT_ELEVATION = Math.PI / 6;
const CAMERA_DISTANCE = Math.hypot(24, 31, 30);
const MIN_ELEVATION = (28 * Math.PI) / 180;
const MAX_ELEVATION = (66 * Math.PI) / 180;
const angleDelta = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
interface SceneOptions {
  interactionRoot: HTMLElement;
  onframe: (frame: CityFrame) => void;
  onselect: (id: string) => void;
  onlost: () => void;
}

export class CityScene {
  static async create(host: HTMLElement, options: SceneOptions): Promise<CityScene> {
    return new CityScene(host, options, await loadCitySpriteSheets());
  }

  readonly canvas: HTMLCanvasElement;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 800);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly observer: ResizeObserver;
  private readonly intersection: IntersectionObserver;
  private readonly unsubscribeMotion: () => void;
  private readonly abort = new AbortController();
  private readonly atlas: CitySpriteAtlas;
  // World-space lines share the city's camera, so every gesture keeps them aligned.
  private readonly grid = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { ink: { value: new THREE.Color() }, blockSize: { value: CITY_BLOCK_SIZE } },
      vertexShader: `
        varying vec2 world;
        void main() {
          vec4 positionInWorld = modelMatrix * vec4(position, 1.0);
          world = positionInWorld.xz;
          gl_Position = projectionMatrix * viewMatrix * positionInWorld;
        }
      `,
      fragmentShader: `
        uniform vec3 ink;
        uniform float blockSize;
        varying vec2 world;
        float gridLine(float spacing) {
          vec2 cell = world / spacing + 0.5;
          vec2 footprint = max(fwidth(cell), vec2(0.0001));
          vec2 distanceToLine = abs(fract(cell - 0.5) - 0.5) / footprint;
          float line = 1.0 - min(min(distanceToLine.x, distanceToLine.y), 1.0);
          // Fade subpixel cells instead of letting dense lines shimmer during zoom.
          return line * (1.0 - smoothstep(0.15, 0.45, max(footprint.x, footprint.y)));
        }
        void main() {
          float alpha = max(gridLine(blockSize / 4.0) * 0.12, gridLine(blockSize) * 0.22);
          gl_FragColor = vec4(ink, alpha);
          #include <colorspace_fragment>
        }
      `,
    }),
  );
  private readonly themeObserver: MutationObserver;
  private art: CityArt | null = null;
  private matches = new Set<string>();
  private selected: string | null = null;
  private hovered: string | null = null;
  private width = 1;
  private height = 1;
  private view: CameraView = {
    x: 0,
    y: 0.8,
    z: 0,
    span: 24,
    yaw: DEFAULT_YAW,
    elevation: DEFAULT_ELEVATION,
  };
  private home: CameraView = { ...this.view };
  private motion: { from: CameraView; to: CameraView; start: number } | null = null;
  private history: CameraView[] = [];
  private frame = 0;
  private visible = true;
  private disposed = false;
  private lost = false;
  private structure = '';
  private bounds = new THREE.Box3();
  private readonly pointers = new Map<number, CityPointer>();

  private constructor(
    private readonly host: HTMLElement,
    private readonly options: SceneOptions,
    sheets: Awaited<ReturnType<typeof loadCitySpriteSheets>>,
  ) {
    this.atlas = new CitySpriteAtlas(sheets);
    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: 'low-power',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setClearColor(0, 0);
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.canvas = this.renderer.domElement;
    this.canvas.dataset.cityCanvas = '';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.host.append(this.canvas);
    this.grid.rotation.x = -Math.PI / 2;
    this.grid.position.y = -2;
    this.scene.add(this.grid);
    const updateTheme = () => {
      const theme = this.readTheme();
      this.grid.material.uniforms.ink.value.copy(theme.foreground);
      this.art?.setTheme(theme);
      this.invalidate();
    };
    this.themeObserver = new MutationObserver(updateTheme);
    for (let element: HTMLElement | null = host; element; element = element.parentElement) {
      this.themeObserver.observe(element, {
        attributes: true,
        attributeFilter: ['class', 'style', 'data-theme'],
      });
    }
    updateTheme();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.intersection = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      if (this.visible) this.invalidate();
      else {
        cancelAnimationFrame(this.frame);
        this.frame = 0;
      }
    });
    this.intersection.observe(host);
    this.unsubscribeMotion = onReducedMotionChange((reduced) => {
      if (reduced) {
        if (this.motion) this.view = { ...this.motion.to };
        this.motion = null;
      }
      this.invalidate();
    });
    const { signal } = this.abort;
    this.canvas.addEventListener(
      'webglcontextlost',
      (event) => {
        event.preventDefault();
        this.lost = true;
        this.cancelGesture();
        cancelAnimationFrame(this.frame);
        this.frame = 0;
        options.onlost();
      },
      { signal },
    );
    options.interactionRoot.addEventListener('pointerdown', this.pointerDown, { signal });
    options.interactionRoot.addEventListener('pointermove', this.pointerMove, { signal });
    options.interactionRoot.addEventListener('pointerleave', () => this.hover(null), { signal });
    this.canvas.addEventListener('pointerup', this.pointerUp, { signal });
    this.canvas.addEventListener('pointercancel', this.pointerCancel, { signal });
    this.canvas.addEventListener('lostpointercapture', this.pointerCancel, { signal });
    options.interactionRoot.addEventListener('wheel', this.wheel, { passive: false, signal });
    options.interactionRoot.addEventListener(
      'contextmenu',
      (event) => {
        if (this.inputTarget(event)) event.preventDefault();
      },
      { signal },
    );
    window.addEventListener('blur', this.cancelGesture, { signal });
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden) {
          this.cancelGesture();
          cancelAnimationFrame(this.frame);
          this.frame = 0;
        } else this.invalidate();
      },
      { signal },
    );
    this.resize();
  }

  update(
    model: CityModel,
    layout: CityLayout,
    matches: readonly string[],
    selected: string | null,
  ) {
    this.matches = new Set(matches);
    this.selected = selected;
    const structure = JSON.stringify([
      model.buildings.map((building) => [
        building.id,
        building.floors,
        building.files,
        building.status,
      ]),
      model.repositories,
      layout,
    ]);
    if (structure !== this.structure) {
      const initial = !this.art || this.bounds.isEmpty();
      if (this.art) {
        this.scene.remove(this.art.group);
        this.art.dispose();
      }
      this.art = new CityArt(model, layout, this.readTheme(), this.atlas);
      this.scene.add(this.art.group);
      this.structure = structure;
      this.bounds.makeEmpty();
      for (const district of this.art.districts) {
        const bounds = cityDistrictBounds(district);
        this.bounds.expandByPoint(new THREE.Vector3(bounds.minX - 1.4, -1.5, bounds.minZ - 1.4));
        this.bounds.expandByPoint(new THREE.Vector3(bounds.maxX + 1.4, 5.8, bounds.maxZ + 1.4));
      }
      for (const anchor of this.art.anchors.values())
        this.bounds.expandByPoint(new THREE.Vector3(anchor.x, anchor.y + 1, anchor.z));
      this.fitHome();
      if (initial || this.bounds.isEmpty()) {
        this.history = [];
        this.view = { ...this.home, span: this.home.span * (prefersReducedMotion() ? 1 : 1.14) };
        this.move(this.home, false);
      }
    }
    this.art?.appearance(model, this.matches, selected);
    this.invalidate();
  }

  focus(id: string) {
    const anchor = this.art?.anchors.get(id);
    if (!anchor) return;
    this.move({
      ...(this.motion?.to ?? this.view),
      x: anchor.x,
      y: anchor.y * 0.4,
      z: anchor.z,
      span: Math.max(9, anchor.y + 6),
    });
  }

  focusRepository(id: string) {
    const districts = this.art?.districts.filter((district) => district.repositoryId === id) ?? [];
    if (!districts.length) return;
    const box = new THREE.Box3();
    for (const district of districts) {
      const bounds = cityDistrictBounds(district);
      box.expandByPoint(new THREE.Vector3(bounds.minX, -1.5, bounds.minZ));
      box.expandByPoint(new THREE.Vector3(bounds.maxX, 5.8, bounds.maxZ));
    }
    for (const anchor of this.art?.anchors.values() ?? []) {
      if (anchor.district.repositoryId === id) {
        const elevation = (this.motion?.to ?? this.view).elevation;
        const height = ((anchor.y + 1) * Math.cos(DEFAULT_ELEVATION)) / Math.cos(elevation);
        box.expandByPoint(new THREE.Vector3(anchor.x, height, anchor.z));
      }
    }
    const center = box.getCenter(new THREE.Vector3());
    const target = {
      ...(this.motion?.to ?? this.view),
      x: center.x,
      y: center.y,
      z: center.z,
      span: 20,
    };
    this.setCamera(target);
    let extent = 0;
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          const projected = new THREE.Vector3(x, y, z).project(this.camera);
          extent = Math.max(extent, Math.abs(projected.x) / 0.8, Math.abs(projected.y) / 0.75);
        }
      }
    }
    this.setCamera(this.view);
    this.move({ ...target, span: Math.max(12, 20 * extent) });
  }

  overview() {
    this.move(this.home);
  }

  back(): boolean {
    const previous = this.history.pop();
    if (!previous) return false;
    this.move(previous, false);
    return true;
  }

  zoom(factor: number) {
    const view = this.motion?.to ?? this.view;
    this.move(
      { ...view, span: Math.max(6, Math.min(this.home.span * 2, view.span * factor)) },
      false,
    );
  }

  orbit(yaw: number, elevation = 0, animate = true) {
    const view = animate ? (this.motion?.to ?? this.view) : this.view;
    const next = {
      ...view,
      yaw: view.yaw + yaw,
      elevation: THREE.MathUtils.clamp(view.elevation + elevation, MIN_ELEVATION, MAX_ELEVATION),
    };
    if (animate) this.move(next, false);
    else {
      this.view = next;
      this.motion = null;
      this.invalidate();
    }
  }

  resetAngle() {
    this.move({
      ...(this.motion?.to ?? this.view),
      yaw: DEFAULT_YAW,
      elevation: DEFAULT_ELEVATION,
    });
  }

  pan(dx: number, dy: number) {
    if (this.bounds.isEmpty()) return;
    const view = this.motion?.to ?? this.view;
    const scale = view.span / this.height;
    const right = new THREE.Vector3(Math.cos(view.yaw), 0, -Math.sin(view.yaw));
    const forward = new THREE.Vector3(-right.z, 0, right.x);
    const offset = right
      .multiplyScalar(-dx * scale)
      .add(forward.multiplyScalar((-dy * scale) / Math.sin(view.elevation)));
    const margin = this.home.span * 0.5;
    this.view = {
      ...view,
      x: THREE.MathUtils.clamp(
        view.x + offset.x,
        this.bounds.min.x - margin,
        this.bounds.max.x + margin,
      ),
      z: THREE.MathUtils.clamp(
        view.z + offset.z,
        this.bounds.min.z - margin,
        this.bounds.max.z + margin,
      ),
    };
    this.motion = null;
    this.invalidate();
  }

  private move(to: CameraView, remember = true) {
    if (remember) {
      this.history.push({ ...this.view });
      if (this.history.length > 30) this.history.shift();
    }
    const from = { ...this.view };
    const destination = { ...to, yaw: from.yaw + angleDelta(to.yaw - from.yaw) };
    if (prefersReducedMotion()) {
      this.view = destination;
      this.motion = null;
    } else this.motion = { from, to: destination, start: performance.now() };
    this.invalidate();
  }

  private fitHome() {
    if (this.bounds.isEmpty()) {
      this.home = {
        x: 0,
        y: 0.8,
        z: 0,
        span: 24,
        yaw: DEFAULT_YAW,
        elevation: DEFAULT_ELEVATION,
      };
      return;
    }
    const center = this.bounds.getCenter(new THREE.Vector3());
    this.home = {
      x: center.x,
      y: 0.8,
      z: center.z,
      span: 20,
      yaw: DEFAULT_YAW,
      elevation: DEFAULT_ELEVATION,
    };
    this.setCamera(this.home);
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    const points: THREE.Vector3[] = [];
    for (const district of this.art?.districts ?? []) {
      const bounds = cityDistrictBounds(district);
      for (const x of [bounds.minX - 1.4, bounds.maxX + 1.4])
        for (const z of [bounds.minZ - 1.4, bounds.maxZ + 1.4])
          points.push(new THREE.Vector3(x, -1.4, z));
    }
    for (const anchor of this.art?.anchors.values() ?? []) {
      points.push(new THREE.Vector3(anchor.x, anchor.y + 1.2, anchor.z));
    }
    for (const position of points) {
      const point = position.project(this.camera);
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }
    this.home.span = Math.max(15, 20 * Math.max((maxX - minX) / 1.75, (maxY - minY) / 1.58));
  }

  private resize() {
    const width = Math.max(1, this.host.clientWidth),
      height = Math.max(1, this.host.clientHeight);
    const atHome =
      Math.abs(this.view.span - this.home.span) < 0.05 &&
      Math.abs(this.view.x - this.home.x) < 0.05 &&
      Math.abs(this.view.z - this.home.z) < 0.05 &&
      Math.abs(angleDelta(this.view.yaw - this.home.yaw)) < 0.001 &&
      Math.abs(this.view.elevation - this.home.elevation) < 0.001;
    this.width = width;
    this.height = height;
    this.renderer.setSize(width, height);
    this.fitHome();
    if (atHome) {
      this.view = { ...this.home };
      this.motion = null;
    }
    this.invalidate();
  }

  private setCamera(view: CameraView) {
    const aspect = this.width / this.height;
    this.camera.left = (-view.span * aspect) / 2;
    this.camera.right = (view.span * aspect) / 2;
    this.camera.top = view.span / 2;
    this.camera.bottom = -view.span / 2;
    const horizontal = CAMERA_DISTANCE * Math.cos(view.elevation);
    this.camera.position.set(
      view.x + horizontal * Math.sin(view.yaw),
      view.y + CAMERA_DISTANCE * Math.sin(view.elevation),
      view.z + horizontal * Math.cos(view.yaw),
    );
    this.camera.lookAt(view.x, view.y, view.z);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  private invalidate() {
    if (this.frame || this.disposed || this.lost || !this.visible || document.hidden) return;
    this.frame = requestAnimationFrame(this.render);
  }

  private render = (now: number) => {
    this.frame = 0;
    if (this.disposed || this.lost) return;
    if (this.motion) {
      const progress = Math.min(1, (now - this.motion.start) / (spring.slow.settleMs * 2));
      const t = spring.slow.easing(progress);
      const { from, to } = this.motion;
      this.view = {
        x: THREE.MathUtils.lerp(from.x, to.x, t),
        y: THREE.MathUtils.lerp(from.y, to.y, t),
        z: THREE.MathUtils.lerp(from.z, to.z, t),
        span: THREE.MathUtils.lerp(from.span, to.span, t),
        yaw: THREE.MathUtils.lerp(from.yaw, to.yaw, t),
        elevation: THREE.MathUtils.lerp(from.elevation, to.elevation, t),
      };
      if (progress === 1) this.motion = null;
    }
    this.setCamera(this.view);
    const size =
      (this.view.span * Math.max(1, this.width / this.height) * 4) / Math.sin(this.view.elevation);
    this.grid.scale.set(size, size, 1);
    this.grid.position.set(this.view.x, -2, this.view.z);
    this.art?.view(this.view.yaw);
    this.renderer.render(this.scene, this.camera);
    this.projectLabels();
    if (this.motion) this.invalidate();
  };

  private projectLabels() {
    if (!this.art) return;
    const project = (id: string, x: number, y: number, z: number): CityLabel => {
      const point = new THREE.Vector3(x, y, z).project(this.camera);
      return {
        id,
        x: ((point.x + 1) * this.width) / 2,
        y: ((1 - point.y) * this.height) / 2,
        visible: Math.abs(point.x) < 0.95 && Math.abs(point.y) < 0.88,
      };
    };
    const buildings = [...this.art.anchors.values()].map((anchor) => {
      const height =
        ((anchor.y + 0.5) * Math.cos(DEFAULT_ELEVATION)) / Math.cos(this.view.elevation);
      const point = project(anchor.id, anchor.x, height, anchor.z);
      point.visible =
        point.visible &&
        this.matches.has(point.id) &&
        (point.id === this.selected || point.id === this.hovered);
      return point;
    });
    this.options.onframe({
      buildings,
      zoom: this.home.span / this.view.span,
      draws: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      moving: !!this.motion,
      yaw: this.view.yaw,
      elevation: this.view.elevation,
    });
  }

  private pick(event: PointerEvent): string | null {
    const rect = this.canvas.getBoundingClientRect();
    return (
      this.art?.pick(
        new THREE.Vector2(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          -((event.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        this.camera,
      ) ?? null
    );
  }

  private inputTarget(event: Event): HTMLElement | null {
    return event.target instanceof Element
      ? event.target.closest<HTMLElement>('[data-city-canvas], [data-city-building]')
      : null;
  }

  private pointerDown = (event: PointerEvent) => {
    const target = this.inputTarget(event);
    if (!target || (event.button !== 0 && event.button !== 1 && event.button !== 2)) return;
    event.preventDefault();
    this.hover(null);
    this.host.focus({ preventScroll: true });
    this.canvas.setPointerCapture(event.pointerId);
    this.motion = null;
    this.pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      orbit: !event.shiftKey && event.button === 0,
      selectable: !event.shiftKey && event.button === 0,
      label: target === this.canvas ? null : target,
    });
    if (this.pointers.size > 1) {
      for (const pointer of this.pointers.values()) pointer.moved = true;
    }
    this.invalidate();
  };
  private pointerMove = (event: PointerEvent) => {
    const previous = this.pointers.get(event.pointerId);
    if (!previous) {
      const target = this.inputTarget(event);
      const id =
        target === this.canvas
          ? this.pick(event)
          : (target?.getAttribute('data-city-building') ?? null);
      this.hover(id);
      this.canvas.style.cursor = id ? 'pointer' : 'grab';
      return;
    }
    const dx = event.clientX - previous.x,
      dy = event.clientY - previous.y;
    if (Math.hypot(event.clientX - previous.startX, event.clientY - previous.startY) > 4)
      previous.moved = true;
    if (this.pointers.size > 1) {
      const other = [...this.pointers.entries()].find(([id]) => id !== event.pointerId)?.[1];
      if (other) {
        const before = Math.hypot(previous.x - other.x, previous.y - other.y);
        const after = Math.hypot(event.clientX - other.x, event.clientY - other.y);
        this.pan(dx / 2, dy / 2);
        if (before > 12 && after > 12) {
          const turn = angleDelta(
            Math.atan2(event.clientY - other.y, event.clientX - other.x) -
              Math.atan2(previous.y - other.y, previous.x - other.x),
          );
          this.view.span = THREE.MathUtils.clamp(
            (this.view.span * before) / after,
            6,
            this.home.span * 2,
          );
          this.orbit(-turn, 0, false);
        }
      }
    } else if (previous.moved) {
      if (previous.orbit) this.orbit(-dx * 0.004, dy * 0.003, false);
      else this.pan(dx, dy);
    }
    previous.x = event.clientX;
    previous.y = event.clientY;
    if (previous.moved) this.canvas.style.cursor = 'grabbing';
  };
  private pointerUp = (event: PointerEvent) => {
    const pointer = this.pointers.get(event.pointerId);
    const select = pointer && !pointer.moved && pointer.selectable && this.pointers.size === 1;
    const id = select && !pointer.label ? this.pick(event) : null;
    this.pointerCancel(event);
    // Capture keeps drags alive as labels move. Only an unmodified tap activates a label.
    if (select && pointer.label) pointer.label.click();
    else if (id) this.options.onselect(id);
  };
  private pointerCancel = (event: PointerEvent) => {
    if (!this.pointers.delete(event.pointerId)) return;
    if (this.canvas.hasPointerCapture(event.pointerId))
      this.canvas.releasePointerCapture(event.pointerId);
    for (const pointer of this.pointers.values()) {
      pointer.startX = pointer.x;
      pointer.startY = pointer.y;
      pointer.moved = true;
    }
    this.canvas.style.cursor = 'grab';
  };
  private cancelGesture = () => {
    this.hover(null);
    const ids = [...this.pointers.keys()];
    this.pointers.clear();
    for (const id of ids) {
      if (this.canvas.hasPointerCapture(id)) this.canvas.releasePointerCapture(id);
    }
    this.canvas.style.cursor = 'grab';
  };
  private wheel = (event: WheelEvent) => {
    if (!this.inputTarget(event)) return;
    event.preventDefault();
    this.hover(null);
    const unit =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? this.height
          : 1;
    const dx = event.deltaX * unit,
      dy = event.deltaY * unit;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    this.motion = null;
    if (event.ctrlKey || event.metaKey) {
      const previousSpan = this.view.span;
      this.view.span = THREE.MathUtils.clamp(
        previousSpan * Math.exp(THREE.MathUtils.clamp(dy, -100, 100) * 0.006),
        6,
        this.home.span * 2,
      );
      const rect = this.canvas.getBoundingClientRect();
      const anchorScale = 1 - previousSpan / this.view.span;
      this.pan(
        (event.clientX - rect.left - rect.width / 2) * anchorScale,
        (event.clientY - rect.top - rect.height / 2) * anchorScale,
      );
      this.invalidate();
    } else if (event.shiftKey) this.pan(-(dx || dy), 0);
    else this.pan(-dx, -dy);
  };

  private hover(id: string | null) {
    if (id === this.hovered) return;
    this.hovered = id;
    this.invalidate();
  }

  private readTheme(): CityTheme {
    // Resolve CSS colors through the browser so aliases and color-mix work too.
    const probe = document.createElement('span');
    probe.style.display = 'none';
    this.options.interactionRoot.append(probe);
    const color = (token: string) => {
      probe.style.color = `var(${token})`;
      return new THREE.Color().setStyle(getComputedStyle(probe).color);
    };
    const theme = {
      background: color('--diagram-canvas'),
      foreground: color('--city-ink'),
      muted: color('--city-muted'),
      accent: color('--city-accent'),
      statuses: {
        running: color('--city-running'),
        attention: color('--city-attention'),
        blocked: color('--city-blocked'),
        complete: color('--city-complete'),
        idle: color('--city-idle'),
      },
    };
    probe.remove();
    return theme;
  }

  dispose() {
    this.disposed = true;
    this.cancelGesture();
    cancelAnimationFrame(this.frame);
    this.abort.abort();
    this.unsubscribeMotion();
    this.observer.disconnect();
    this.intersection.disconnect();
    this.themeObserver.disconnect();
    this.grid.geometry.dispose();
    this.grid.material.dispose();
    this.art?.dispose();
    this.atlas.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
    this.scene.clear();
  }
}
