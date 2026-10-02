import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { prefersReducedMotion, spring } from '$lib/motion';
import { onReducedMotionChange } from '$lib/utils/reduced-motion';
import type { CityModel } from './home-city-model';
import type { CityLayout } from './home-city-layout';
import { CityArt, CITY_DETAIL_LIMIT } from './city-art';

interface CityLabel {
  id: string;
  x: number;
  y: number;
  visible: boolean;
}
export interface CityFrame {
  buildings: CityLabel[];
  repositories: (CityLabel & { repositoryId: string; count: number })[];
  zoom: number;
  draws: number;
  triangles: number;
  moving: boolean;
}
interface CameraView {
  x: number;
  y: number;
  z: number;
  span: number;
}
interface SceneOptions {
  onframe: (frame: CityFrame) => void;
  onselect: (id: string) => void;
  onlost: () => void;
}

export class CityScene {
  readonly canvas: HTMLCanvasElement;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 800);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly observer: ResizeObserver;
  private readonly intersection: IntersectionObserver;
  private readonly environment: THREE.WebGLRenderTarget;
  private readonly unsubscribeMotion: () => void;
  private readonly abort = new AbortController();
  private readonly raycaster = new THREE.Raycaster();
  private art: CityArt | null = null;
  private model: CityModel = { repositories: [], buildings: [] };
  private matches = new Set<string>();
  private selected: string | null = null;
  private width = 1;
  private height = 1;
  private view: CameraView = { x: 0, y: 0.8, z: 0, span: 24 };
  private home: CameraView = { ...this.view };
  private motion: { from: CameraView; to: CameraView; start: number } | null = null;
  private history: CameraView[] = [];
  private frame = 0;
  private visible = true;
  private disposed = false;
  private lost = false;
  private structure = '';
  private bounds = new THREE.Box3();
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private press: { x: number; y: number; moved: boolean } | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly options: SceneOptions,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: 'low-power',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setClearColor(0, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.canvas = this.renderer.domElement;
    this.canvas.dataset.cityCanvas = '';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.host.append(this.canvas);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, 0.05);
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = 0.9;
    room.dispose();
    pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight('#e6f4ff', '#c2b6a3', 1.15));
    const sun = new THREE.DirectionalLight('#fff0d3', 3);
    sun.position.set(-18, 30, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -40;
    sun.shadow.camera.right = 40;
    sun.shadow.camera.top = 40;
    sun.shadow.camera.bottom = -40;
    sun.shadow.camera.far = 100;
    sun.shadow.normalBias = 0.04;
    sun.shadow.bias = -0.0002;
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight('#c9e5ff', 1.1);
    fill.position.set(10, 9, -20);
    this.scene.add(fill);
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
      if (reduced && this.motion) {
        this.view = { ...this.motion.to };
        this.motion = null;
        this.invalidate();
      }
    });
    const { signal } = this.abort;
    this.canvas.addEventListener(
      'webglcontextlost',
      (event) => {
        event.preventDefault();
        this.lost = true;
        cancelAnimationFrame(this.frame);
        this.frame = 0;
        options.onlost();
      },
      { signal },
    );
    this.canvas.addEventListener('pointerdown', this.pointerDown, { signal });
    this.canvas.addEventListener('pointermove', this.pointerMove, { signal });
    this.canvas.addEventListener('pointerup', this.pointerUp, { signal });
    this.canvas.addEventListener('pointercancel', this.pointerCancel, { signal });
    this.canvas.addEventListener('lostpointercapture', this.pointerCancel, { signal });
    this.canvas.addEventListener('wheel', this.wheel, { passive: false, signal });
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden) {
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
    this.model = model;
    this.matches = new Set(matches);
    this.selected = selected;
    const structure = JSON.stringify([
      model.buildings.map((building) => [building.id, building.floors]),
      layout,
      model.buildings.length > CITY_DETAIL_LIMIT ? selected : null,
    ]);
    if (structure !== this.structure) {
      const initial = !this.art || this.bounds.isEmpty();
      if (this.art) {
        this.scene.remove(this.art.group);
        this.art.dispose();
      }
      this.art = new CityArt(model, layout, selected);
      this.scene.add(this.art.group);
      this.structure = structure;
      this.bounds.makeEmpty();
      for (const island of this.art.islands) {
        this.bounds.expandByPoint(
          new THREE.Vector3(island.x - island.radius, -1.5, island.z - island.radius),
        );
        this.bounds.expandByPoint(
          new THREE.Vector3(island.x + island.radius, 5.8, island.z + island.radius),
        );
      }
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
    this.move({ x: anchor.x, y: anchor.y * 0.4, z: anchor.z, span: Math.max(9, anchor.y + 6) });
  }

  focusRepository(id: string) {
    const islands = this.art?.islands.filter((island) => island.repositoryId === id) ?? [];
    if (!islands.length) return;
    const box = new THREE.Box3();
    for (const island of islands) {
      box.expandByPoint(new THREE.Vector3(island.x - island.radius, 0, island.z - island.radius));
      box.expandByPoint(new THREE.Vector3(island.x + island.radius, 5, island.z + island.radius));
    }
    const center = box.getCenter(new THREE.Vector3()),
      size = box.getSize(new THREE.Vector3());
    this.move({
      x: center.x,
      y: 1.2,
      z: center.z,
      span: Math.max(12, size.z, size.x / (this.width / this.height)) * 1.25,
    });
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

  pan(dx: number, dy: number) {
    if (this.bounds.isEmpty()) return;
    const view = this.motion?.to ?? this.view;
    const scale = view.span / this.height;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const forward = new THREE.Vector3(-right.z, 0, right.x);
    const offset = right.multiplyScalar(-dx * scale).add(forward.multiplyScalar(-dy * scale * 1.3));
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
    if (prefersReducedMotion()) {
      this.view = { ...to };
      this.motion = null;
    } else this.motion = { from: { ...this.view }, to: { ...to }, start: performance.now() };
    this.invalidate();
  }

  private fitHome() {
    if (this.bounds.isEmpty()) {
      this.home = { x: 0, y: 0.8, z: 0, span: 24 };
      return;
    }
    const center = this.bounds.getCenter(new THREE.Vector3());
    this.home = { x: center.x, y: 0.8, z: center.z, span: 20 };
    this.setCamera(this.home);
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    const points: THREE.Vector3[] = [];
    for (const island of this.art?.islands ?? []) {
      for (let i = 0; i < 16; i++) {
        const angle = (i * Math.PI) / 8;
        points.push(
          new THREE.Vector3(
            island.x + Math.cos(angle) * island.radius,
            -1.4,
            island.z + Math.sin(angle) * island.radius,
          ),
        );
      }
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
      Math.abs(this.view.x - this.home.x) < 0.05;
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
    this.camera.position.set(view.x + 24, view.y + 31, view.z + 30);
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
      };
      if (progress === 1) this.motion = null;
    }
    this.setCamera(this.view);
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
    const boxes: { x: number; y: number; width: number; height: number }[] = [];
    const modelById = new Map(this.model.buildings.map((building) => [building.id, building]));
    const anchors = [...this.art.anchors.values()].sort(
      (a, b) =>
        Number(b.id === this.selected) - Number(a.id === this.selected) ||
        Number(this.matches.has(b.id)) - Number(this.matches.has(a.id)) ||
        Number(modelById.get(b.id)?.status === 'attention') -
          Number(modelById.get(a.id)?.status === 'attention'),
    );
    const budget = Math.max(2, Math.floor((this.width * this.height) / 68000));
    let labels = 0;
    const buildings = anchors.map((anchor) => {
      const point = project(anchor.id, anchor.x, anchor.y + 0.5, anchor.z);
      const width = Math.min(190, 36 + (modelById.get(anchor.id)?.title.length ?? 0) * 6.4);
      const box = { x: point.x - width / 2, y: point.y - 32, width, height: 42 };
      const overlaps = boxes.some(
        (other) =>
          box.x < other.x + other.width + 8 &&
          box.x + box.width + 8 > other.x &&
          box.y < other.y + other.height &&
          box.y + box.height > other.y,
      );
      const selected = point.id === this.selected;
      point.visible =
        point.visible && this.matches.has(point.id) && (selected || (!overlaps && labels < budget));
      if (point.visible) {
        boxes.push(box);
        labels++;
      }
      return point;
    });
    const anchorsByIsland = new Map<string, number>();
    for (const anchor of anchors)
      anchorsByIsland.set(anchor.island.id, (anchorsByIsland.get(anchor.island.id) ?? 0) + 1);
    const repositories = this.art.islands.map((island) => {
      const point = project(island.id, island.x, 0.05, island.z + island.radius + 0.55);
      const count = anchorsByIsland.get(island.id) ?? 0;
      return { ...point, repositoryId: island.repositoryId, count };
    });
    this.options.onframe({
      buildings,
      repositories,
      zoom: this.home.span / this.view.span,
      draws: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      moving: !!this.motion,
    });
  }

  private pick(event: PointerEvent): string | null {
    const rect = this.canvas.getBoundingClientRect();
    this.raycaster.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      this.camera,
    );
    let nearest: string | null = null,
      distance = Infinity;
    for (const [id, box] of this.art?.pickBoxes ?? []) {
      if (!this.matches.has(id)) continue;
      const hit = this.raycaster.ray.intersectBox(box, new THREE.Vector3());
      if (!hit) continue;
      const d = hit.distanceToSquared(this.raycaster.ray.origin);
      if (d < distance) {
        nearest = id;
        distance = d;
      }
    }
    return nearest;
  }

  private pointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    this.host.focus({ preventScroll: true });
    this.canvas.setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.press = { x: event.clientX, y: event.clientY, moved: this.pointers.size > 1 };
  };
  private pointerMove = (event: PointerEvent) => {
    const previous = this.pointers.get(event.pointerId);
    if (!previous) {
      this.canvas.style.cursor = this.pick(event) ? 'pointer' : 'grab';
      return;
    }
    if (this.pointers.size > 1) {
      const other = [...this.pointers.entries()].find(([id]) => id !== event.pointerId)?.[1];
      if (other) {
        const before = Math.hypot(previous.x - other.x, previous.y - other.y);
        const after = Math.hypot(event.clientX - other.x, event.clientY - other.y);
        if (before > 0 && after > 0) this.zoom(before / after);
      }
    } else this.pan(event.clientX - previous.x, event.clientY - previous.y);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.press && Math.hypot(event.clientX - this.press.x, event.clientY - this.press.y) > 4)
      this.press.moved = true;
    this.canvas.style.cursor = 'grabbing';
  };
  private pointerUp = (event: PointerEvent) => {
    if (this.press && !this.press.moved) {
      const id = this.pick(event);
      if (id) this.options.onselect(id);
    }
    this.pointerCancel(event);
  };
  private pointerCancel = (event: PointerEvent) => {
    this.pointers.delete(event.pointerId);
    this.press = null;
    if (this.canvas.hasPointerCapture(event.pointerId))
      this.canvas.releasePointerCapture(event.pointerId);
    this.canvas.style.cursor = 'grab';
  };
  private wheel = (event: WheelEvent) => {
    event.preventDefault();
    if (event.shiftKey) this.pan(-event.deltaX - event.deltaY, 0);
    else this.zoom(Math.exp(THREE.MathUtils.clamp(event.deltaY, -100, 100) * 0.002));
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.abort.abort();
    this.unsubscribeMotion();
    this.observer.disconnect();
    this.intersection.disconnect();
    this.art?.dispose();
    this.environment.dispose();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Light && 'shadow' in object)
        (object.shadow as THREE.LightShadow).dispose();
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
    this.scene.clear();
  }
}
