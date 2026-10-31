/**
 * Browser-only fixtures for `DockAnnotationOverlay` (no Electron, no capture):
 * component tests mount the overlay with these states and a recording transport.
 */
import type {
  DockAnnotationAck,
  DockAnnotationGestureRequest,
  DockAnnotationMediaState,
  DockAnnotationOverlayState,
  DockAnnotationOverlayTransport,
  DockAnnotationPointerRequest,
} from '$shared/dock-annotation';

const display = { width: 1280, height: 800 };

export const dockAnnotationLiveEmpty: DockAnnotationOverlayState = {
  sessionId: 'fixture-live',
  mode: 'live',
  tool: 'box',
  display,
  image: null,
  still: null,
  marks: [],
  marksRevision: 0,
  // The dock column on the right edge.
  excluded: [{ x: 1000, y: 0, width: 280, height: 800 }],
  pick: 'ready',
  displayId: 1,
  // Menu bar (25) above, the macOS Dock (70) below.
  workArea: { x: 0, y: 25, width: 1280, height: 705 },
  // The dock as an edge rail on the right (the excluded column above).
  dock: { shape: 'edge', side: 'right', rect: { x: 1000, y: 0, width: 280, height: 800 } },
  mouse: false,
  media: null,
};

/** The composer's Screenshot/Record as the dock sends them: idle, nothing blocked. */
export const dockAnnotationMediaIdle: DockAnnotationMediaState = {
  capture: {
    label: 'Capture the screen · ⌘⇧S',
    tooltip: 'Capture the screen · ⌘⇧S',
    disabled: false,
    pending: false,
    alert: false,
  },
  record: {
    label: 'Record the screen · ⌘⇧R',
    tooltip: 'Record the screen · ⌘⇧R',
    disabled: false,
    pending: false,
    alert: false,
    recording: false,
    startedAt: null,
  },
};

/** Retina capture (2×): image pixels are twice the overlay DIP. */
export const dockAnnotationLiveMarked: DockAnnotationOverlayState = {
  ...dockAnnotationLiveEmpty,
  image: { width: 2560, height: 1600 },
  marks: [
    { n: 1, tool: 'pick', geometry: { kind: 'rect', x: 240, y: 300, w: 448, h: 144 } },
    { n: 2, tool: 'box', geometry: { kind: 'rect', x: 1200, y: 200, w: 400, h: 240 } },
    {
      n: 3,
      tool: 'pen',
      geometry: {
        kind: 'path',
        points: [
          { x: 300, y: 1000 },
          { x: 420, y: 960 },
          { x: 560, y: 1040 },
          { x: 700, y: 980 },
        ],
      },
    },
    {
      n: 4,
      tool: 'arrow',
      geometry: { kind: 'arrow', from: { x: 1500, y: 1300 }, to: { x: 1250, y: 1050 } },
    },
  ],
  marksRevision: 4,
};

/** A 4:3 still on a 16:10 display is letterboxed, never stretched. */
export const dockAnnotationStill: DockAnnotationOverlayState = {
  ...dockAnnotationLiveEmpty,
  sessionId: 'fixture-still',
  mode: 'still',
  tool: 'arrow',
  image: { width: 1600, height: 1200 },
  still: { imageId: 'img-1', width: 1600, height: 1200 },
  marks: [{ n: 1, tool: 'box', geometry: { kind: 'rect', x: 200, y: 200, w: 400, h: 300 } }],
  marksRevision: 1,
  pick: 'unavailable',
};

/** 1×1 transparent PNG; stands in for frozen still pixels. */
export const dockAnnotationStillUrl =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

export interface RecordingTransport extends DockAnnotationOverlayTransport {
  pointers: DockAnnotationPointerRequest[];
  gestures: DockAnnotationGestureRequest[];
}

export function recordingTransport(
  answer: (request: DockAnnotationGestureRequest) => DockAnnotationAck = () => ({ ok: true }),
): RecordingTransport {
  const pointers: DockAnnotationPointerRequest[] = [];
  const gestures: DockAnnotationGestureRequest[] = [];
  return {
    pointers,
    gestures,
    pointer: async (request) => {
      pointers.push(request);
      return { ok: true };
    },
    gesture: async (request) => {
      gestures.push(request);
      return answer(request);
    },
  };
}
