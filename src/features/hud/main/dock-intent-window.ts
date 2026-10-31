/**
 * Marks on Intent's own main windows. The accessibility helper cannot see into
 * Chromium reliably, so the window's own document answers: whether a point lies in
 * the embedded browser panel (never markable) and which element is under a point
 * (role, accessible name, DOM path).
 */
import { BrowserWindow } from 'electron';
import { dockWindowIdFromMediaSourceId, type DockAxElement } from '../../../shared/dock-annotation';
import { isDockAnnotationWindow } from '../../../main/dock-annotation-identity';
import { getDockWindow } from '../../../main/dock-window';

interface Point {
  x: number;
  y: number;
}

export type DockIntentWindowInspection =
  | { kind: 'other' }
  | { kind: 'failed' }
  | { kind: 'intent'; inPanel: boolean; element: DockAxElement | null };

export interface DockIntentWindowRequest {
  /** Global DIP points that must all lie outside the browser panel. */
  panelPoints: Point[];
  /** Global DIP point whose element is reported; null for none. */
  elementPoint: Point | null;
}

const TIMEOUT_MS = 300;

/**
 * Runs in the window's page as plain source (never a serialized compiled function,
 * which bundler helpers would break). Inputs and output are CSS pixels.
 */
const PROBE = `(panelPoints, elementPoint) => {
  const inside = (rect, p) => rect.width > 0 && rect.height > 0 &&
    p.x >= rect.left && p.x < rect.right && p.y >= rect.top && p.y < rect.bottom;
  const panels = [...document.querySelectorAll('webview')].map((node) => node.getBoundingClientRect());
  const inPanel = panelPoints.some((p) => panels.some((rect) => inside(rect, p)));
  if (inPanel || !elementPoint) return { inPanel, element: null };
  const hit = document.elementFromPoint(elementPoint.x, elementPoint.y);
  const node = (hit && hit.closest('button,a[href],input,select,textarea,summary,[role],[aria-label],[contenteditable="true"]')) || hit;
  if (!node || node === document.documentElement || node === document.body) return { inPanel, element: null };
  const tag = node.tagName.toLowerCase();
  const type = (node.getAttribute('type') || '').toLowerCase();
  const implicit = { a: 'link', button: 'button', select: 'combobox', textarea: 'textbox', img: 'image',
    summary: 'button', h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading' };
  const inputRole = ['checkbox', 'radio'].includes(type) ? type
    : ['button', 'submit', 'reset'].includes(type) ? 'button' : 'textbox';
  const role = node.getAttribute('role') || (tag === 'input' ? inputRole : implicit[tag] || tag);
  const labelled = (node.getAttribute('aria-labelledby') || '').split(/\s+/)
    .map((id) => (id && document.getElementById(id) ? document.getElementById(id).textContent : '') || '').join(' ');
  const text = (value) => (value || '').replace(/\s+/g, ' ').trim();
  const name = text(node.getAttribute('aria-label') || labelled || node.getAttribute('alt') ||
    node.getAttribute('title') || node.getAttribute('placeholder') || node.innerText).slice(0, 120);
  const segments = [];
  for (let at = node; at && at !== document.body && segments.length < 8; ) {
    const parent = at.parentElement;
    let segment = at.tagName.toLowerCase();
    if (at.id) segment += '#' + at.id;
    else if (parent) {
      const same = [...parent.children].filter((child) => child.tagName === at.tagName);
      if (same.length > 1) segment += ':nth-of-type(' + (same.indexOf(at) + 1) + ')';
    }
    segments.unshift(segment);
    if (at.id) break;
    at = parent;
  }
  const rect = node.getBoundingClientRect();
  return { inPanel, element: { role, name, path: segments.join(' > ').slice(0, 512),
    rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height } } };
}`; // i18n-ignore (page script, not user-facing copy)

function intentWindow(windowId: number): BrowserWindow | null {
  const dock = getDockWindow();
  return (
    BrowserWindow.getAllWindows().find(
      (window) =>
        !window.isDestroyed() &&
        window !== dock &&
        !isDockAnnotationWindow(window) &&
        dockWindowIdFromMediaSourceId(window.getMediaSourceId()) === windowId,
    ) ?? null
  );
}

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** Converts the page's CSS-pixel answer back to global DIP; null when malformed. */
function toGlobalElement(element: unknown, origin: Point, zoom: number): DockAxElement | null {
  if (!element || typeof element !== 'object') return null;
  const row = element as Record<string, unknown>;
  const rect = row.rect as Record<string, unknown> | undefined;
  if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(finite)) return null;
  const width = (rect.width as number) * zoom;
  const height = (rect.height as number) * zoom;
  if (width <= 0 || height <= 0) return null;
  const text = (value: unknown, max: number) =>
    typeof value === 'string' ? value.slice(0, max) : '';
  const path = text(row.path, 512);
  return {
    role: text(row.role, 64),
    name: text(row.name, 512),
    ...(path ? { path } : {}),
    rect: {
      x: origin.x + (rect.x as number) * zoom,
      y: origin.y + (rect.y as number) * zoom,
      width,
      height,
    },
  };
}

export async function inspectDockIntentWindow(
  windowId: number,
  request: DockIntentWindowRequest,
): Promise<DockIntentWindowInspection> {
  const window = intentWindow(windowId);
  if (!window) return { kind: 'other' };
  const contents = window.webContents;
  if (contents.isDestroyed()) return { kind: 'failed' };
  const origin = window.getContentBounds();
  const zoom = contents.getZoomFactor();
  if (!finite(zoom) || zoom <= 0) return { kind: 'failed' };
  const local = (p: Point) => ({ x: (p.x - origin.x) / zoom, y: (p.y - origin.y) / zoom });
  const source = `(${PROBE})(${JSON.stringify(request.panelPoints.map(local))}, ${JSON.stringify(
    request.elementPoint ? local(request.elementPoint) : null,
  )})`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const answer = (await Promise.race([
      contents.executeJavaScript(source, true),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), TIMEOUT_MS);
      }),
    ])) as { inPanel?: unknown; element?: unknown } | null;
    // An unknown panel answer is never treated as "outside the panel".
    if (!answer || typeof answer.inPanel !== 'boolean') return { kind: 'failed' };
    return {
      kind: 'intent',
      inPanel: answer.inPanel,
      element: answer.inPanel ? null : toGlobalElement(answer.element, origin, zoom),
    };
  } catch {
    return { kind: 'failed' };
  } finally {
    clearTimeout(timer);
  }
}
